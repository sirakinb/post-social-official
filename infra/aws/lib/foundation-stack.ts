// The pieces every environment shares and that cost nothing (or cents) to keep: the network,
// the image registry, the container cluster and the roles GitHub deploys with.
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
<<<<<<< HEAD
import { ACCOUNT, AVAILABILITY_ZONES, CLUSTER_NAME, deployRoleName, ENVIRONMENTS, ENV_NAMES, GITHUB_OIDC_PROVIDER_ARN, GITHUB_REPO, imageTagParameter, REGION, type EnvName } from "./config";
=======
import { AVAILABILITY_ZONES, ENVIRONMENTS, ENV_NAMES, GITHUB_OIDC_PROVIDER_ARN, GITHUB_REPO, type EnvName } from "./config";
>>>>>>> origin/dev

export class FoundationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly repositories: { api: ecr.Repository; worker: ecr.Repository };
  readonly deployRoles: Record<EnvName, iam.Role>;

  // Named zones instead of a lookup, so building the templates needs no AWS sign-in.
  get availabilityZones() {
    return AVAILABILITY_ZONES;
  }

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Two zones. Public subnets hold the load balancer and the containers (each with a public
    // address, reachable only through the load balancer's firewall rule). Isolated subnets
    // hold the databases: no route to or from the internet. No NAT gateway (about $33 a month).
    this.vpc = new ec2.Vpc(this, "Network", {
      vpcName: "postsocial",
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      availabilityZones: AVAILABILITY_ZONES,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, mapPublicIpOnLaunch: false },
        { name: "database", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      restrictDefaultSecurityGroup: true,
      // A record of accepted and refused connections, for looking into anything odd.
      flowLogs: {
        all: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            new logs.LogGroup(this, "NetworkLogs", { logGroupName: "/postsocial/network", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
          ),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    acknowledge(this.vpc, { id: "CloudFormation-Validate::W3010", reason: "The two zones are named on purpose, so building the templates needs no AWS sign-in and the subnets never move." });

    // One repository per image, shared by dev and prod: prod runs the exact image dev tested.
    const repository = (name: "api" | "worker") =>
      new ecr.Repository(this, `${name}Images`, {
        repositoryName: `postsocial/${name}`,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [
          { description: "Remove untagged images after a week", tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: Duration.days(7) },
          { description: "Keep the last 50 images", maxImageCount: 50 },
        ],
      });
    this.repositories = { api: repository("api"), worker: repository("worker") };

<<<<<<< HEAD
    this.cluster = new ecs.Cluster(this, "Cluster", { clusterName: CLUSTER_NAME, vpc: this.vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    // GitHub signs in as these roles with its own identity, so no AWS keys are stored in
    // GitHub. Each role trusts one branch of this repository and the GitHub environment that
    // is itself limited to that branch. Here they can push images and record which build
    // their own environment runs; rights to roll out a service are added by the services stack.
    const deployRole = (envName: EnvName) => {
      const { deployBranch, githubEnvironment } = ENVIRONMENTS[envName];
      const role = new iam.Role(this, `GitHubDeploy-${envName}`, {
        roleName: deployRoleName(envName),
=======
    this.cluster = new ecs.Cluster(this, "Cluster", { clusterName: "postsocial", vpc: this.vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    // GitHub signs in as these roles with its own identity, so no AWS keys are stored in
    // GitHub. Each role trusts one branch of this repository and the GitHub environment that
    // is itself limited to that branch. They can push images; rights to roll out a service
    // are added with the services.
    const deployRole = (envName: EnvName) => {
      const { deployBranch, githubEnvironment } = ENVIRONMENTS[envName];
      const role = new iam.Role(this, `GitHubDeploy-${envName}`, {
        roleName: `postsocial-github-deploy-${envName}`,
>>>>>>> origin/dev
        description: `GitHub Actions on ${deployBranch} of ${GITHUB_REPO}: deploy Post Social ${envName}`,
        maxSessionDuration: Duration.hours(1),
        assumedBy: new iam.WebIdentityPrincipal(GITHUB_OIDC_PROVIDER_ARN, {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubSubjects(deployBranch, githubEnvironment),
          },
        }),
      });
<<<<<<< HEAD
      for (const images of Object.values(this.repositories)) {
        images.grantPush(role);
        // Lets a re-run see that a commit's image is already there (tags can't be overwritten).
        images.grant(role, "ecr:DescribeImages");
      }
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter", "ssm:PutParameter"],
          resources: [`arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${imageTagParameter(envName)}`],
        }),
      );
      // Read-only, and here rather than with the services so a deploy can tell "not created
      // yet" from "not allowed" before its environment's services exist.
      const ownServices = `arn:aws:ecs:${REGION}:${ACCOUNT}:service/${CLUSTER_NAME}/postsocial-${envName}-*`;
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:DescribeServices"], resources: [ownServices] }));
      acknowledge(role, { id: `AwsSolutions-IAM5[Resource::${ownServices}]`, reason: "Reading the state of this environment's own services (its API and worker), which are created later by the services stack." });
=======
      this.repositories.api.grantPush(role);
      this.repositories.worker.grantPush(role);
>>>>>>> origin/dev
      acknowledge(role, { id: "AwsSolutions-IAM5[Resource::*]", reason: "ecr:GetAuthorizationToken has no resource to limit it to; every other right names the two repositories." });
      return role;
    };
    this.deployRoles = Object.fromEntries(ENV_NAMES.map((name) => [name, deployRole(name)])) as Record<EnvName, iam.Role>;

    acknowledge(this.cluster, { id: "AwsSolutions-ECS4", reason: "Container Insights is a paid extra; logs and the uptime check cover us at this size. Revisit when traffic grows." });
  }
}

// What GitHub puts in the identity token: the branch for a plain job, the environment for a
// job that names one (GitHub only lets that environment run from its branch).
export function githubSubjects(branch: string, environment: string) {
  return [
    `repo:${GITHUB_REPO}:ref:refs/heads/${branch}`,
    `repo:${GITHUB_REPO}:environment:${environment}`,
    `repo:${GITHUB_REPO}:environment:${environment.toLowerCase()}`,
  ];
}
