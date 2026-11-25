// One environment's running pieces: the API behind the shared load balancer, the worker, and
// the two one-off tasks that work on the database from inside the network (set up and
// migrate; fill from a copy of InsForge). Kept apart from the data stack so changing a
// service can never replace the database.
//
// This stack decides the shape (sizes, settings, firewall rules, who may deploy). Which build
// runs is decided by the deploy workflow (scripts/aws-deploy.mjs), one commit at a time.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
import { ACCOUNT, CLUSTER_NAME, CONTAINER_PORT, DATABASE_NAME, deployRoleName, ENVIRONMENTS, imageTagParameter, REGION, type EnvName } from "./config";
import type { DataStack } from "./data-stack";
import type { EdgeStack } from "./edge-stack";
import type { FoundationStack } from "./foundation-stack";

export interface ServicesStackProps extends StackProps {
  envName: EnvName;
  foundation: FoundationStack;
  edge: EdgeStack;
  data: DataStack;
}

const PLAIN_SETTINGS = { id: "AwsSolutions-ECS2", reason: "Only addresses and names are set directly (database host, the API's own address, the environment's name). Every secret value comes from Secrets Manager." };

export class ServicesStack extends Stack {
  readonly api: ecs.FargateService;
  readonly worker: ecs.FargateService;
  readonly migrate: ecs.FargateTaskDefinition;
  readonly copy: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);
    const { envName, foundation, edge, data } = props;
    const { apiDomain, apiTasks, appEnv, listenerPriority, workerCpu, workerTasks } = ENVIRONMENTS[envName];
    const { cluster, repositories, vpc } = foundation;
    const name = (part: string) => `postsocial-${envName}-${part}`;

    // The commit whose images run here. Read from AWS at every deploy of this stack, so a
    // change to the stack keeps the build that is live (see config.ts).
    const imageTag = ssm.StringParameter.valueForStringParameter(this, imageTagParameter(envName));

    // The firewall groups, taken as they are: every rule between the load balancer, the
    // containers and the database is written out, here or in the data stack, never implied.
    const apiAccess = ec2.SecurityGroup.fromSecurityGroupId(this, "ApiAccess", data.apiSecurityGroup.securityGroupId, { mutable: false });
    const workerAccess = ec2.SecurityGroup.fromSecurityGroupId(this, "WorkerAccess", data.workerSecurityGroup.securityGroupId, { mutable: false });
    const fromLoadBalancer = new ec2.CfnSecurityGroupIngress(this, "LoadBalancerToApi", {
      groupId: data.apiSecurityGroup.securityGroupId,
      sourceSecurityGroupId: edge.securityGroup.securityGroupId,
      ipProtocol: "tcp",
      fromPort: CONTAINER_PORT,
      toPort: CONTAINER_PORT,
      description: `Load balancer to the ${envName} API`,
    });
    const toApi = new ec2.CfnSecurityGroupEgress(this, "LoadBalancerOutToApi", {
      groupId: edge.securityGroup.securityGroupId,
      destinationSecurityGroupId: data.apiSecurityGroup.securityGroupId,
      ipProtocol: "tcp",
      fromPort: CONTAINER_PORT,
      toPort: CONTAINER_PORT,
      description: `To the ${envName} API`,
    });

    const database = {
      DATABASE_HOST: data.database.dbInstanceEndpointAddress,
      DATABASE_PORT: data.database.dbInstanceEndpointPort,
      DATABASE_NAME,
    };
    const appPassword = ecs.Secret.fromSecretsManager(data.appLogin, "password");
    const task = (part: string, cpu: number, memoryLimitMiB: number) =>
      new ecs.FargateTaskDefinition(this, `${part}Task`, {
        family: name(part),
        cpu,
        memoryLimitMiB,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
    // No NAT gateway, so each container needs its own public address to reach the image
    // registry, Secrets Manager and the platforms. Its firewall group decides who can reach it.
    const placement = { vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, assignPublicIp: true };
    // A new build must come up healthy before the old one is stopped; if it doesn't, AWS
    // goes back to the old one by itself.
    const rollout = { circuitBreaker: { enable: true, rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 };

    // --- API ---------------------------------------------------------------------------
    const apiTask = task("api", 256, 512);
    apiTask.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(repositories.api, imageTag),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: {
        ...database,
        APP_ENV: appEnv,
        PORT: String(CONTAINER_PORT),
        // Where platforms are sent back to when the website isn't forwarding for us.
        CONNECTIONS_BASE_URL: `https://${apiDomain}/connections`,
      },
      secrets: { SETTINGS_JSON: ecs.Secret.fromSecretsManager(data.settings.api), DATABASE_PASSWORD: appPassword },
      logging: ecs.LogDrivers.awsLogs({ logGroup: data.logGroups.api, streamPrefix: "api" }),
      // The service finishes the requests in hand for up to 25 seconds (backend/server.ts).
      stopTimeout: Duration.seconds(30),
      readonlyRootFilesystem: true,
    });
    this.api = new ecs.FargateService(this, "Api", {
      serviceName: name("api"),
      cluster,
      taskDefinition: apiTask,
      desiredCount: apiTasks,
      securityGroups: [apiAccess],
      ...placement,
      ...rollout,
      healthCheckGracePeriod: Duration.seconds(60),
      enableExecuteCommand: false,
    });
    this.api.node.addDependency(fromLoadBalancer, toApi);

    const targets = new elbv2.ApplicationTargetGroup(this, "ApiTargets", {
      vpc,
      port: CONTAINER_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      // /healthz doesn't touch the database, so a database blip never empties the pool.
      healthCheck: { path: "/healthz", healthyHttpCodes: "200", interval: Duration.seconds(15), timeout: Duration.seconds(5), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
      deregistrationDelay: Duration.seconds(30),
    });
    // Attached by hand rather than with the service's helper, which would add firewall
    // rules of its own to groups that belong to other stacks.
    targets.addTarget(this.api.loadBalancerTarget({ containerName: "api", containerPort: CONTAINER_PORT }));
    // The shared listener answers this environment's address with this environment's API.
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, "Https", {
      listenerArn: edge.httpsListener.listenerArn,
      securityGroup: ec2.SecurityGroup.fromSecurityGroupId(this, "LoadBalancerAccess", edge.securityGroup.securityGroupId, { mutable: false }),
    });
    new elbv2.ApplicationListenerRule(this, "ApiAddress", {
      listener,
      priority: listenerPriority,
      conditions: [elbv2.ListenerCondition.hostHeaders([apiDomain])],
      targetGroups: [targets],
    });

    // --- Worker ------------------------------------------------------------------------
    const workerTask = task("worker", workerCpu, 1024);
    workerTask.addContainer("worker", {
      image: ecs.ContainerImage.fromEcrRepository(repositories.worker, imageTag),
      environment: { ...database, APP_ENV: appEnv, PORT: String(CONTAINER_PORT), CONNECTIONS_BASE_URL: `https://${apiDomain}/connections` },
      secrets: { SETTINGS_JSON: ecs.Secret.fromSecretsManager(data.settings.worker), DATABASE_PASSWORD: appPassword },
      logging: ecs.LogDrivers.awsLogs({ logGroup: data.logGroups.worker, streamPrefix: "worker" }),
      // Nothing calls the worker, so the container reports its own health: unhealthy when
      // the job loop has stalled (worker/src/index.ts), and AWS replaces it.
      healthCheck: {
        command: ["CMD", "node", "-e", `fetch("http://127.0.0.1:${CONTAINER_PORT}/health").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      stopTimeout: Duration.seconds(30),
    });
    this.worker = new ecs.FargateService(this, "Worker", {
      serviceName: name("worker"),
      cluster,
      taskDefinition: workerTask,
      // Never more than one: two workers would both renew the same platform tokens. None
      // while this environment's worker still runs on InsForge (config.ts).
      desiredCount: workerTasks,
      securityGroups: [workerAccess],
      ...placement,
      circuitBreaker: rollout.circuitBreaker,
      // Stop the old worker before starting the new one, so there are never two.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      enableExecuteCommand: false,
    });

    // --- Database setup and migrations -------------------------------------------------
    // Run by the deploy before the services roll: the API's image with a different command.
    // It signs in as the database's owner, which the running services never do.
    this.migrate = task("migrate", 256, 512);
    const owner = data.database.secret!;
    this.migrate.addContainer("migrate", {
      image: ecs.ContainerImage.fromEcrRepository(repositories.api, imageTag),
      command: ["node", "migrate.mjs", "--bootstrap"],
      environment: { ...database },
      secrets: {
        DATABASE_OWNER_USERNAME: ecs.Secret.fromSecretsManager(owner, "username"),
        DATABASE_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(owner, "password"),
        // The password app_admin is given (as a hash), so the services can sign in with it.
        DATABASE_PASSWORD: appPassword,
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup: data.logGroups.api, streamPrefix: "migrate" }),
      readonlyRootFilesystem: true,
    });

    // --- Filling the database from a copy of InsForge ----------------------------------
    // Started by hand (scripts/aws-copy-database.mjs), never by a deploy: the GitHub role
    // below is given neither this task nor its roles. It runs Postgres's own tools, signs
    // in as the owner, and reads InsForge's address from a secret that holds it only while
    // a copy runs.
    const copySource = new secretsmanager.Secret(this, "CopySource", {
      secretName: `postsocial/${envName}/copy-source`,
      description: `Post Social ${envName}: the InsForge database address, only while a copy runs (scripts/aws-copy-database.mjs)`,
      secretStringValue: SecretValue.unsafePlainText("not set"),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.copy = task("copy", 256, 512);
    this.copy.addVolume({ name: "scratch" });
    const copyContainer = this.copy.addContainer("copy", {
      // Postgres 15's client tools, the same major version as both databases.
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/docker/library/postgres:15"),
      command: ["bash", "-c", readFileSync(path.join(__dirname, "../../../database/copy-from-insforge.sh"), "utf8")],
      environment: {
        PGHOST: data.database.dbInstanceEndpointAddress,
        PGPORT: data.database.dbInstanceEndpointPort,
        PGDATABASE: DATABASE_NAME,
        // Encrypted. The image has no copy of AWS's certificate authorities to check the
        // database's certificate against; the connection never leaves our network.
        PGSSLMODE: "require",
        WORK_DIR: "/work",
      },
      secrets: {
        SOURCE_URL: ecs.Secret.fromSecretsManager(copySource),
        PGUSER: ecs.Secret.fromSecretsManager(owner, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(owner, "password"),
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup: data.logGroups.api, streamPrefix: "copy" }),
      readonlyRootFilesystem: true,
    });
    // Where the dump sits while the task runs; it goes when the task does.
    copyContainer.addMountPoints({ sourceVolume: "scratch", containerPath: "/work", readOnly: false });

    // --- What the GitHub deploy role may do here ---------------------------------------
    // Added to the role the foundation stack made, which only this environment's branch can
    // use. It can roll these two services and run this migration task, with these roles.
    const taskRoles = [apiTask, workerTask, this.migrate].flatMap((definition) => [definition.taskRole.roleArn, definition.obtainExecutionRole().roleArn]);
    // Written out in full (not built from tokens) so they read the same in every build.
    const ecsArn = (resource: string) => `arn:aws:ecs:${REGION}:${ACCOUNT}:${resource}`;
    const migrateVersions = ecsArn(`task-definition/${name("migrate")}:*`);
    const clusterTasks = ecsArn(`task/${CLUSTER_NAME}/*`);
    const inThisCluster = { ArnEquals: { "ecs:cluster": cluster.clusterArn } };
    const deployRights = new iam.Policy(this, "DeployRights", {
      policyName: name("deploy"),
      roles: [iam.Role.fromRoleName(this, "DeployRole", deployRoleName(envName), { mutable: false })],
      statements: [
        new iam.PolicyStatement({ sid: "ReadAndRollServices", actions: ["ecs:DescribeServices", "ecs:UpdateService"], resources: [this.api.serviceArn, this.worker.serviceArn] }),
        // AWS has no way to limit these two to a task family; the statements below do the limiting.
        new iam.PolicyStatement({ sid: "NewTaskVersions", actions: ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], resources: ["*"] }),
        new iam.PolicyStatement({ sid: "RunMigrations", actions: ["ecs:RunTask"], resources: [migrateVersions], conditions: inThisCluster }),
        new iam.PolicyStatement({
          sid: "WatchTasks",
          actions: ["ecs:DescribeTasks"],
          resources: [clusterTasks],
          conditions: inThisCluster,
        }),
        new iam.PolicyStatement({ sid: "HandTasksTheirRoles", actions: ["iam:PassRole"], resources: taskRoles, conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } } }),
      ],
    });

    acknowledge(copySource, { id: "AwsSolutions-SMG4", reason: "Holds a value only for the minutes a copy runs; the script that starts the copy blanks it afterwards." });
    for (const definition of [apiTask, workerTask, this.migrate, this.copy]) {
      acknowledge(definition, PLAIN_SETTINGS);
      acknowledge(definition.obtainExecutionRole(), { id: "AwsSolutions-IAM5[Resource::*]", reason: "ecr:GetAuthorizationToken has no resource to limit it to; pulling images and reading secrets name their own." });
    }
    acknowledge(deployRights, {
      id: "AwsSolutions-IAM5[Resource::*]",
      reason: "ECS doesn't support naming a task family for reading or registering task definitions. What a deploy can then do with one is limited by the other statements: it can only run the migration family, only in our cluster, and only hand tasks this environment's roles.",
    });
    acknowledge(deployRights, {
      id: `AwsSolutions-IAM5[Resource::${migrateVersions}]`,
      reason: "Every version of this environment's migration task: each deploy registers a new one for its build.",
    });
    acknowledge(deployRights, { id: `AwsSolutions-IAM5[Resource::${clusterTasks}]`, reason: "Task ids aren't known ahead of time; the condition keeps it to our cluster and the right is read-only." });
  }
}
