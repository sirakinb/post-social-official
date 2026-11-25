// One environment's data: its database, who may reach it, its settings and its logs.
// Kept apart from the services so a service change can never replace the database.
import { Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { acknowledge } from "./acknowledge";
import { ENVIRONMENTS, type EnvName } from "./config";

export interface DataStackProps extends StackProps {
  envName: EnvName;
  vpc: ec2.IVpc;
}

export class DataStack extends Stack {
  readonly apiSecurityGroup: ec2.SecurityGroup;
  readonly workerSecurityGroup: ec2.SecurityGroup;
  readonly database: rds.DatabaseInstance;
  readonly settings: { api: secretsmanager.Secret; worker: secretsmanager.Secret };
  readonly logGroups: { api: logs.LogGroup; worker: logs.LogGroup };

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { envName, vpc } = props;
    const { backupDays, protect } = ENVIRONMENTS[envName];
    const keep = protect ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // The firewall groups the API and worker containers will run in. They exist here so the
    // database can name them as its only allowed callers.
    this.apiSecurityGroup = new ec2.SecurityGroup(this, "ApiAccess", { vpc, description: `Post Social ${envName} API containers`, allowAllOutbound: true });
    this.workerSecurityGroup = new ec2.SecurityGroup(this, "WorkerAccess", { vpc, description: `Post Social ${envName} worker container`, allowAllOutbound: true });
    const databaseAccess = new ec2.SecurityGroup(this, "DatabaseAccess", { vpc, description: `Post Social ${envName} database: the API and worker only`, allowAllOutbound: false });
    databaseAccess.addIngressRule(this.apiSecurityGroup, ec2.Port.tcp(5432), "API");
    databaseAccess.addIngressRule(this.workerSecurityGroup, ec2.Port.tcp(5432), "Worker");

    // Made before the database so its log group gets a 30-day limit instead of keeping logs forever.
    const databaseLogs = new logs.LogGroup(this, "DatabaseLogs", {
      logGroupName: `/aws/rds/instance/postsocial-${envName}/postgresql`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: keep,
    });

    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 });
    this.database = new rds.DatabaseInstance(this, "Database", {
      instanceIdentifier: `postsocial-${envName}`,
      engine,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseAccess],
      publiclyAccessible: false,
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      databaseName: "postsocial",
      // The owner login, used for setup and migrations only. The API and worker sign in
      // with their own, narrower logins, kept in their settings below.
      credentials: rds.Credentials.fromGeneratedSecret("postsocial_admin", { secretName: `postsocial/${envName}/database-admin` }),
      parameterGroup: new rds.ParameterGroup(this, "DatabaseSettings", {
        engine,
        description: `Post Social ${envName}: encrypted connections only, slow queries logged`,
        parameters: { "rds.force_ssl": "1", log_min_duration_statement: "1000" },
      }),
      backupRetention: Duration.days(backupDays),
      preferredBackupWindow: "07:00-08:00", // about 2am US Eastern
      // Both ends need the day: RDS rejects "Sun:08:30-09:30" at deploy time.
      preferredMaintenanceWindow: "Sun:08:30-Sun:09:30",
      autoMinorVersionUpgrade: true,
      copyTagsToSnapshot: true,
      cloudwatchLogsExports: ["postgresql"],
      deletionProtection: protect,
      // Deleting the stack keeps prod's database and leaves a final snapshot of dev's.
      removalPolicy: protect ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT,
    });
    this.database.node.addDependency(databaseLogs);

    // Each service's settings as one JSON secret. Created empty; values are added by hand
    // (never from this repo), and a deploy leaves them alone.
    const settings = (service: "api" | "worker") =>
      new secretsmanager.Secret(this, `${service}Settings`, {
        secretName: `postsocial/${envName}/${service}`,
        description: `Post Social ${envName} ${service}: every setting the service reads, as one JSON object`,
        secretStringValue: SecretValue.unsafePlainText("{}"),
        removalPolicy: RemovalPolicy.RETAIN,
      });
    this.settings = { api: settings("api"), worker: settings("worker") };

    const serviceLogs = (service: "api" | "worker") =>
      new logs.LogGroup(this, `${service}Logs`, { logGroupName: `/postsocial/${envName}/${service}`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: keep });
    this.logGroups = { api: serviceLogs("api"), worker: serviceLogs("worker") };

    acknowledge(
      this.database,
      { id: "AwsSolutions-RDS3", reason: "One zone for now (a standby roughly doubles the database cost). Turn on Multi-AZ once there are paying users; automatic backups cover recovery until then." },
      { id: "AwsSolutions-RDS11", reason: "The database has no public address and accepts only the API and worker; a non-default port adds nothing." },
      { id: "AwsSolutions-SMG4", reason: "The owner login is used for setup and migrations only; rotate it by hand when someone with access leaves." },
    );
    if (!protect) acknowledge(this.database, { id: "AwsSolutions-RDS10", reason: "Dev holds test data and is rebuilt freely; prod has deletion protection." });
    for (const secret of Object.values(this.settings)) {
      acknowledge(secret, { id: "AwsSolutions-SMG4", reason: "Holds third-party keys (platforms, Stripe, R2) that are rotated at their source, not by AWS." });
    }
  }
}
