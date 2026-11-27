// The nightly backup of an environment's database: a dump made inside the network and kept
// in our backup bucket, apart from the database and its own automatic backups.
//
// One task, two containers that share a scratch folder: Postgres's own tools dump the
// database and check the dump (database/backup-dump.sh); if that succeeds, AWS's command-line
// tool sends it to the bucket (database/backup-upload.sh). AWS starts it every night. A run
// that fails sends a message to the alerts topic.
//
// Its own stack, so changing the backup can never touch a service or the database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
import { ACCOUNT, BACKUP_BUCKET, BACKUP_FOLDERS, BACKUP_GITHUB_ROLE, CLUSTER_NAME, DATABASE_NAME, REGION, type EnvName } from "./config";
import type { DataStack } from "./data-stack";
import type { FoundationStack } from "./foundation-stack";

export interface BackupStackProps extends StackProps {
  envName: EnvName;
  foundation: FoundationStack;
  data: DataStack;
}

const script = (file: string) => readFileSync(path.join(__dirname, "../../../database", file), "utf8");

export class BackupStack extends Stack {
  readonly task: ecs.FargateTaskDefinition;
  readonly alerts: sns.Topic;

  constructor(scope: Construct, id: string, props: BackupStackProps) {
    super(scope, id, props);
    const { envName, foundation, data } = props;
    const { cluster } = foundation;
    const family = `postsocial-${envName}-backup`;
    const backupName = `postsocial-${envName}`;
    const owner = data.database.secret!;

    this.task = new ecs.FargateTaskDefinition(this, "Task", {
      family,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    // Where the dump sits between the two containers; it goes when the task does.
    this.task.addVolume({ name: "scratch" });
    const logging = (streamPrefix: string) => ecs.LogDrivers.awsLogs({ logGroup: data.logGroups.api, streamPrefix });

    const dump = this.task.addContainer("dump", {
      // Postgres 15's client tools, the same major version as the database.
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/docker/library/postgres:15"),
      command: ["bash", "-c", script("backup-dump.sh")],
      // Not essential, so the task goes on to the upload when this one ends well.
      essential: false,
      environment: {
        PGHOST: data.database.dbInstanceEndpointAddress,
        PGPORT: data.database.dbInstanceEndpointPort,
        PGDATABASE: DATABASE_NAME,
        // Encrypted. The image has no copy of AWS's certificate authorities to check the
        // database's certificate against; the connection never leaves our network.
        PGSSLMODE: "require",
        WORK_DIR: "/work",
        BACKUP_NAME: backupName,
        // A dump with fewer tables or less data than this is a broken or wiped database.
        MIN_PUBLIC_TABLES: "30",
        MIN_BYTES: "1000000",
      },
      secrets: {
        // The owner login, because a dump must be able to read everything. The script's
        // session refuses any statement that would write.
        PGUSER: ecs.Secret.fromSecretsManager(owner, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(owner, "password"),
      },
      logging: logging("backup-dump"),
      readonlyRootFilesystem: true,
    });
    dump.addMountPoints({ sourceVolume: "scratch", containerPath: "/work", readOnly: false });

    const upload = this.task.addContainer("upload", {
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/aws-cli/aws-cli:2.42.4"),
      entryPoint: ["bash", "-c"],
      command: [script("backup-upload.sh")],
      environment: { WORK_DIR: "/work", HOME: "/work", BACKUP_NAME: backupName, BUCKET: BACKUP_BUCKET },
      logging: logging("backup-upload"),
      readonlyRootFilesystem: true,
    });
    upload.addMountPoints({ sourceVolume: "scratch", containerPath: "/work", readOnly: false });
    // Only a dump that passed its own checks is uploaded. If the dump fails, this container
    // never starts and the task ends as failed.
    upload.addContainerDependencies({ container: dump, condition: ecs.ContainerDependencyCondition.SUCCESS });

    // The task can add files to the two backup folders. It can't read, list or delete them.
    const folders = BACKUP_FOLDERS.map((folder) => `arn:aws:s3:::${BACKUP_BUCKET}/${folder}/*`);
    this.task.addToTaskRolePolicy(new iam.PolicyStatement({ sid: "AddBackups", actions: ["s3:PutObject", "s3:AbortMultipartUpload"], resources: folders }));

    // --- Every night -------------------------------------------------------------------
    // Started by AWS, not by a GitHub schedule: GitHub runs this repository's schedules a
    // few times a day at best (seen 2026-11-27: "every 5 minutes" ran 2 to 4 times a day,
    // and a daily job did not run at all).
    const apiAccess = ec2.SecurityGroup.fromSecurityGroupId(this, "ApiAccess", data.apiSecurityGroup.securityGroupId, { mutable: false });
    const nightly = new events.Rule(this, "Nightly", {
      ruleName: `${family}-nightly`,
      description: `Back up the ${envName} database at about 3am US Eastern`,
      schedule: events.Schedule.cron({ minute: "17", hour: "8" }),
    });
    nightly.addTarget(
      new targets.EcsTask({
        cluster,
        taskDefinition: this.task,
        launchType: ecs.LaunchType.FARGATE,
        // No NAT gateway, so the task needs its own public address to pull its images and
        // reach S3. It borrows the API's firewall group, which the database accepts.
        subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
        assignPublicIp: true,
        securityGroups: [apiAccess],
        taskCount: 1,
      }),
    );

    // --- When a run fails --------------------------------------------------------------
    // A message to the alerts topic. Who receives it is a subscription added by hand, so no
    // email address lives in this repository.
    this.alerts = new sns.Topic(this, "Alerts", { topicName: `postsocial-${envName}-alerts`, displayName: `Post Social ${envName} alerts`, enforceSSL: true });
    const failed = new events.Rule(this, "Failed", {
      ruleName: `${family}-failed`,
      description: `A ${envName} database backup did not finish`,
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          clusterArn: [cluster.clusterArn],
          group: [`family:${family}`],
          lastStatus: ["STOPPED"],
          // A container ended with an error, or the task never started.
          $or: [{ containers: { exitCode: [{ "anything-but": 0 }] } }, { stopCode: ["TaskFailedToStart"] }],
        },
      },
    });
    failed.addTarget(
      new targets.SnsTopic(this.alerts, {
        message: events.RuleTargetInput.fromText(
          `The nightly backup of the Post Social ${envName} database did not finish.\n\nWhy AWS stopped it: ${events.EventField.fromPath("$.detail.stoppedReason")}\nTask: ${events.EventField.fromPath("$.detail.taskArn")}\n\nIts output is in the log group /postsocial/${envName}/api, in the streams starting "backup-dump" and "backup-upload". Run it again by hand with the "Back up prod database" workflow in GitHub.`,
        ),
      }),
    );

    // --- Starting a run by hand, from GitHub -------------------------------------------
    // The "Back up prod database" workflow signs in as this role (made by hand on
    // 2026-11-24; it trusts only main). It can start this task and watch it, nothing else here.
    const ecsArn = (resource: string) => `arn:aws:ecs:${REGION}:${ACCOUNT}:${resource}`;
    const versions = ecsArn(`task-definition/${family}:*`);
    const clusterTasks = ecsArn(`task/${CLUSTER_NAME}/*`);
    const apiService = ecsArn(`service/${CLUSTER_NAME}/postsocial-${envName}-api`);
    const inThisCluster = { ArnEquals: { "ecs:cluster": cluster.clusterArn } };
    const runRights = new iam.Policy(this, "RunRights", {
      policyName: `${family}-run`,
      roles: [iam.Role.fromRoleName(this, "GitHubRole", BACKUP_GITHUB_ROLE, { mutable: false })],
      statements: [
        new iam.PolicyStatement({ sid: "RunBackups", actions: ["ecs:RunTask"], resources: [versions], conditions: inThisCluster }),
        new iam.PolicyStatement({ sid: "WatchTasks", actions: ["ecs:DescribeTasks"], resources: [clusterTasks], conditions: inThisCluster }),
        // To borrow the API's subnets and firewall group for the run.
        new iam.PolicyStatement({ sid: "ReadApiNetwork", actions: ["ecs:DescribeServices"], resources: [apiService] }),
        new iam.PolicyStatement({
          sid: "HandTheTaskItsRoles",
          actions: ["iam:PassRole"],
          resources: [this.task.taskRole.roleArn, this.task.obtainExecutionRole().roleArn],
          conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
        }),
      ],
    });

    acknowledge(this.task, { id: "AwsSolutions-ECS2", reason: "Only names and addresses are set directly (database host, bucket, folder). The database login comes from Secrets Manager." });
    acknowledge(this.task.taskRole, ...folders.map((folder) => ({ id: `AwsSolutions-IAM5[Resource::${folder}]`, reason: "Every file in one backup folder: the names carry the date, so they aren't known ahead of time." })));
    acknowledge(this.task.obtainExecutionRole(), { id: "AwsSolutions-IAM5[Resource::*]", reason: "ecr:GetAuthorizationToken has no resource to limit it to; reading the database login and writing logs name their own." });
    acknowledge(runRights, { id: `AwsSolutions-IAM5[Resource::${versions}]`, reason: "Every version of this one task: a stack change registers a new one." });
    acknowledge(runRights, { id: `AwsSolutions-IAM5[Resource::${clusterTasks}]`, reason: "Task ids aren't known ahead of time; the condition keeps it to our cluster and the right is read-only." });
    acknowledge(this.task.node.findChild("EventsRole"), {
      id: "AwsSolutions-IAM5",
      reason: "The role AWS's scheduler uses to start the nightly run. It may run this one task definition in our cluster; the wildcard is on task ids (for tagging the task it starts), which aren't known ahead of time.",
    });
  }
}
