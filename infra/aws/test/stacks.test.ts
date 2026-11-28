// What the templates must always say, whatever else changes: nothing public that shouldn't
// be, nothing deletable that mustn't be, and deploy roles that only the right branch can use.
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { buildApp } from "../lib/app";
import { ENV_NAMES, GITHUB_SUBJECT } from "../lib/config";

const built = buildApp();
const foundation = Template.fromStack(built.foundation);
const edge = Template.fromStack(built.edge);
const data = { dev: Template.fromStack(built.data.dev), prod: Template.fromStack(built.data.prod) };
const services = { dev: Template.fromStack(built.services.dev), prod: Template.fromStack(built.services.prod) };
const backup = Template.fromStack(built.backups.prod!);
const uptime = Template.fromStack(built.uptime.prod!);
const monitoring = Template.fromStack(built.monitoring);
const all = [foundation, edge, data.dev, data.prod, services.dev, services.prod, backup, uptime, monitoring];

type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Sid?: string; Action: string | string[]; Effect: string; Resource: unknown; Condition?: Record<string, Record<string, unknown>> };
const statementsOf = (policy: Resource) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement;
const actionsOf = (statement: Statement) => [statement.Action].flat();
const resources = (template: Template, type: string) => Object.values(template.findResources(type)) as Resource[];

describe("network", () => {
  it("has no NAT gateway and never hands out public addresses by default", () => {
    foundation.resourceCountIs("AWS::EC2::NatGateway", 0);
    const subnets = resources(foundation, "AWS::EC2::Subnet");
    expect(subnets).toHaveLength(4);
    expect(subnets.every((s) => s.Properties.MapPublicIpOnLaunch === false)).toBe(true);
  });

  it("gives only the public subnets a route to the internet", () => {
    // Two public subnets, one internet route each; the database subnets have none.
    foundation.resourceCountIs("AWS::EC2::Route", 2);
    foundation.allResourcesProperties("AWS::EC2::Route", { DestinationCidrBlock: "0.0.0.0/0", GatewayId: Match.anyValue() });
  });

  it("builds without looking anything up in AWS", () => {
    const zones = resources(foundation, "AWS::EC2::Subnet").map((s) => s.Properties.AvailabilityZone);
    expect(new Set(zones)).toEqual(new Set(["us-east-1a", "us-east-1b"]));
  });
});

describe("image registry", () => {
  it("keeps image tags fixed and scans every push", () => {
    foundation.resourceCountIs("AWS::ECR::Repository", 2);
    foundation.allResourcesProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    expect(resources(foundation, "AWS::ECR::Repository").every((r) => r.DeletionPolicy === "Retain")).toBe(true);
  });
});

describe("GitHub deploy roles", () => {
  const role = (name: string) => resources(foundation, "AWS::IAM::Role").find((r) => r.Properties.RoleName === name)!;
  const subjects = (name: string) => {
    const [statement] = (role(name).Properties.AssumeRolePolicyDocument as { Statement: { Condition: { StringEquals: Record<string, unknown> } }[] }).Statement;
    expect(statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
    return statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"] as string[];
  };

  it("lets only main (and the Production environment) deploy prod", () => {
    expect(subjects("postsocial-github-deploy-prod")).toEqual([
      `${GITHUB_SUBJECT}:ref:refs/heads/main`,
      `${GITHUB_SUBJECT}:environment:Production`,
      `${GITHUB_SUBJECT}:environment:production`,
    ]);
  });

  it("lets only dev (and the Development environment) deploy dev", () => {
    expect(subjects("postsocial-github-deploy-dev")).toEqual([
      `${GITHUB_SUBJECT}:ref:refs/heads/dev`,
      `${GITHUB_SUBJECT}:environment:Development`,
      `${GITHUB_SUBJECT}:environment:development`,
    ]);
  });

  it("never trusts a wildcard, a pull request or another repository", () => {
    for (const name of ["postsocial-github-deploy-dev", "postsocial-github-deploy-prod"]) {
      for (const subject of subjects(name)) {
        expect(subject.startsWith(`${GITHUB_SUBJECT}:`)).toBe(true);
        expect(subject).not.toMatch(/\*|pull_request/);
      }
    }
  });

  it("can push images, record its own environment's build and see its own services, nothing else", () => {
    const policies = resources(foundation, "AWS::IAM::Policy").filter((p) => JSON.stringify(p.Properties.Roles).includes("GitHubDeploy"));
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      const envName = JSON.stringify(policy.Properties.Roles).includes("GitHubDeploydev") ? "dev" : "prod";
      const statements = statementsOf(policy);
      const actions = statements.flatMap(actionsOf);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => (a.startsWith("ecr:") || a.startsWith("ssm:") || a === "ecs:DescribeServices") && !a.includes("*"))).toBe(true);
      const ecs = statements.filter((s) => actionsOf(s).some((a) => a.startsWith("ecs:")));
      expect(ecs).toHaveLength(1);
      expect(ecs[0].Resource).toBe(`arn:aws:ecs:us-east-1:039612844713:service/postsocial/postsocial-${envName}-*`);
      expect(actions).not.toContain("ecr:DeleteRepository");
      expect(actions).not.toContain("ecr:BatchDeleteImage");
      // The one thing it may write outside the registry: which build its environment runs.
      const ssm = statements.filter((s) => actionsOf(s).some((a) => a.startsWith("ssm:")));
      expect(ssm).toHaveLength(1);
      expect(actionsOf(ssm[0]).sort()).toEqual(["ssm:GetParameter", "ssm:PutParameter"]);
      expect(ssm[0].Resource).toBe(`arn:aws:ssm:us-east-1:039612844713:parameter/postsocial/${envName}/image-tag`);
    }
  });
});

describe.each(ENV_NAMES)("%s database", (envName) => {
  const template = data[envName];
  const [database] = resources(template, "AWS::RDS::DBInstance");

  it("is a small, private, encrypted Postgres 15", () => {
    template.resourceCountIs("AWS::RDS::DBInstance", 1);
    expect(database.Properties).toMatchObject({
      Engine: "postgres",
      EngineVersion: "15",
      DBInstanceClass: "db.t4g.micro",
      PubliclyAccessible: false,
      StorageEncrypted: true,
      StorageType: "gp3",
      DBInstanceIdentifier: `postsocial-${envName}`,
    });
  });

  it("accepts connections only from the API and worker, on the Postgres port", () => {
    const ingress = resources(template, "AWS::EC2::SecurityGroupIngress");
    expect(ingress).toHaveLength(2);
    for (const rule of ingress) {
      expect(rule.Properties).toMatchObject({ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432 });
      expect(rule.Properties.SourceSecurityGroupId).toBeDefined();
      expect(rule.Properties.CidrIp).toBeUndefined();
    }
    // No firewall group in this stack lets the internet in.
    for (const group of resources(template, "AWS::EC2::SecurityGroup")) expect(group.Properties.SecurityGroupIngress).toBeUndefined();
  });

  it("refuses unencrypted connections", () => {
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", { Parameters: Match.objectLike({ "rds.force_ssl": "1" }) });
  });

  it("creates the service settings empty, so no value ever comes from this repo", () => {
    const names = resources(template, "AWS::SecretsManager::Secret").map((s) => s.Properties.Name);
    expect(names.sort()).toEqual([`postsocial/${envName}/api`, `postsocial/${envName}/database-admin`, `postsocial/${envName}/database-app`, `postsocial/${envName}/database-viewer`, `postsocial/${envName}/sign-in`, `postsocial/${envName}/worker`]);
    for (const service of ["api", "worker"]) {
      template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/${service}`, SecretString: "{}" });
    }
    // The database passwords and the sign-in key are generated inside AWS, never written here.
    for (const login of ["database-admin", "database-app", "database-viewer", "sign-in"]) {
      template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/${login}`, GenerateSecretString: Match.anyValue() });
    }
  });

  it("keeps logs for 30 days, not forever", () => {
    template.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });
});

describe.each(ENV_NAMES)("database timing: %s", (envName) => {
  it("uses the window formats RDS accepts, and they don't overlap", () => {
    // RDS only checks these when the database is created, so a typo fails the whole deploy.
    const [database] = resources(data[envName], "AWS::RDS::DBInstance");
    const backup = String(database.Properties.PreferredBackupWindow);
    const maintenance = String(database.Properties.PreferredMaintenanceWindow);
    expect(backup).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
    expect(maintenance).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun):\d{2}:\d{2}-(Mon|Tue|Wed|Thu|Fri|Sat|Sun):\d{2}:\d{2}$/);
    const backupEnds = backup.split("-")[1];
    const maintenanceStarts = maintenance.split("-")[0].slice(4);
    expect(backupEnds <= maintenanceStarts).toBe(true);
  });
});

describe.each(ENV_NAMES)("%s services", (envName) => {
  const template = services[envName];
  const domain = envName === "prod" ? "api.postsocial.xyz" : "api-dev.postsocial.xyz";
  const definitions = Object.fromEntries(resources(template, "AWS::ECS::TaskDefinition").map((d) => [d.Properties.Family as string, d]));
  const container = (part: string) => (definitions[`postsocial-${envName}-${part}`].Properties.ContainerDefinitions as Record<string, unknown>[])[0];
  const service = (part: string) => resources(template, "AWS::ECS::Service").find((s) => s.Properties.ServiceName === `postsocial-${envName}-${part}`)!;
  const names = (list: unknown) => (list as { Name: string }[]).map((item) => item.Name).sort();

  it("runs the API, the worker and the three database tasks on ARM64 Fargate", () => {
    expect(Object.keys(definitions).sort()).toEqual(["api", "copy", "migrate", "tunnel", "worker"].map((part) => `postsocial-${envName}-${part}`));
    for (const definition of Object.values(definitions)) {
      expect(definition.Properties).toMatchObject({ RequiresCompatibilities: ["FARGATE"], NetworkMode: "awsvpc", RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" } });
    }
    expect(definitions[`postsocial-${envName}-api`].Properties).toMatchObject({ Cpu: "256", Memory: "512" });
    expect(definitions[`postsocial-${envName}-worker`].Properties).toMatchObject({ Cpu: envName === "prod" ? "512" : "256", Memory: "1024" });
  });

  it("rolls the API with no gap and goes back by itself if a build doesn't come up", () => {
    expect(service("api").Properties).toMatchObject({
      DesiredCount: envName === "prod" ? 2 : 1,
      LaunchType: "FARGATE",
      EnableExecuteCommand: false,
      DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
    });
  });

  it("runs one worker, and never two at once", () => {
    expect(service("worker").Properties).toMatchObject({
      DesiredCount: 1,
      DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 0, MaximumPercent: 100 },
    });
    expect(service("worker").Properties.LoadBalancers).toBeUndefined();
  });

  it("puts each container in its own firewall group, with a public address but no open door", () => {
    for (const part of ["api", "worker"]) {
      const network = (service(part).Properties.NetworkConfiguration as { AwsvpcConfiguration: { AssignPublicIp: string; SecurityGroups: unknown[]; Subnets: unknown[] } }).AwsvpcConfiguration;
      expect(network.AssignPublicIp).toBe("ENABLED");
      expect(network.SecurityGroups).toHaveLength(1);
      expect(JSON.stringify(network.SecurityGroups)).toContain(part === "api" ? "ApiAccess" : "WorkerAccess");
      expect(network.Subnets).toHaveLength(2);
    }
    // The only way in: the load balancer, to the API, on the container port.
    template.resourceCountIs("AWS::EC2::SecurityGroup", 0);
    const ingress = resources(template, "AWS::EC2::SecurityGroupIngress");
    expect(ingress).toHaveLength(1);
    expect(ingress[0].Properties).toMatchObject({ IpProtocol: "tcp", FromPort: 8080, ToPort: 8080 });
    expect(JSON.stringify(ingress[0].Properties.GroupId)).toContain("ApiAccess");
    expect(JSON.stringify(ingress[0].Properties.SourceSecurityGroupId)).toContain("LoadBalancerAccess");
    expect(ingress[0].Properties.CidrIp).toBeUndefined();
    const egress = resources(template, "AWS::EC2::SecurityGroupEgress");
    expect(egress).toHaveLength(1);
    expect(egress[0].Properties).toMatchObject({ IpProtocol: "tcp", FromPort: 8080, ToPort: 8080 });
    expect(JSON.stringify(egress[0].Properties.GroupId)).toContain("LoadBalancerAccess");
    expect(JSON.stringify(egress[0].Properties.DestinationSecurityGroupId)).toContain("ApiAccess");
  });

  it("answers only its own address on the shared listener, checked on /healthz", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Priority: envName === "prod" ? 10 : 20,
      Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [domain] } }],
      Actions: [Match.objectLike({ Type: "forward" })],
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { Port: 8080, Protocol: "HTTP", TargetType: "ip", HealthCheckPath: "/healthz", Matcher: { HttpCode: "200" } });
  });

  it("gives the services their settings from Secrets Manager, and only names and addresses directly", () => {
    for (const part of ["api", "worker"]) {
      const secrets = container(part).Secrets as { Name: string; ValueFrom: unknown }[];
      expect(names(secrets)).toEqual(part === "api" ? ["AUTH_SECRET", "DATABASE_PASSWORD", "SETTINGS_JSON"] : ["DATABASE_PASSWORD", "SETTINGS_JSON"]);
      expect(JSON.stringify(secrets.find((s) => s.Name === "SETTINGS_JSON")!.ValueFrom)).toContain(`${part}Settings`);
      expect(JSON.stringify(secrets.find((s) => s.Name === "DATABASE_PASSWORD")!.ValueFrom)).toMatch(/AppLogin.*:password::/);
      const plain = names(container(part).Environment);
      expect(plain).toEqual([...(part === "api" ? ["AUTH_BASE_URL"] : []), "APP_ENV", "CONNECTIONS_BASE_URL", "DATABASE_HOST", "DATABASE_NAME", "DATABASE_PORT", "PORT"].sort());
      expect(container(part).Environment).toEqual(expect.arrayContaining([
        { Name: "APP_ENV", Value: envName === "prod" ? "production" : "dev" },
        { Name: "CONNECTIONS_BASE_URL", Value: `https://${domain}/connections` },
        { Name: "DATABASE_NAME", Value: "postsocial" },
      ]));
    }
    // Sign-in runs in the API, at its own public address, with a key only the API is given.
    expect(container("api").Environment).toEqual(expect.arrayContaining([{ Name: "AUTH_BASE_URL", Value: `https://${domain}` }]));
    expect(JSON.stringify((container("api").Secrets as { Name: string; ValueFrom: unknown }[]).find((s) => s.Name === "AUTH_SECRET")!.ValueFrom)).toMatch(/SignIn/);
    for (const part of ["worker", "migrate", "copy"]) expect(JSON.stringify(container(part))).not.toMatch(/AUTH_SECRET|SignIn/);
    // The running services never hold the database owner's login.
    for (const part of ["api", "worker"]) expect(JSON.stringify(container(part))).not.toMatch(/DATABASE_OWNER|DatabaseSecret/);
  });

  it("keeps the owner login to the migration task", () => {
    expect(container("migrate").Command).toEqual(["node", "migrate.mjs", "--bootstrap"]);
    expect(names(container("migrate").Secrets)).toEqual(["DATABASE_OWNER_PASSWORD", "DATABASE_OWNER_USERNAME", "DATABASE_PASSWORD", "DATABASE_VIEWER_PASSWORD"]);
    expect(names(container("migrate").Environment)).toEqual(["DATABASE_HOST", "DATABASE_NAME", "DATABASE_PORT"]);
    expect(JSON.stringify(container("migrate").Secrets)).not.toContain("Settings");
    // Each task can read its own secrets and no other's.
    const reads = (part: string) => {
      const policy = resources(template, "AWS::IAM::Policy").find((p) => JSON.stringify(p.Properties.Roles).includes(`${part}TaskExecutionRole`))!;
      return JSON.stringify(statementsOf(policy).filter((s) => actionsOf(s).includes("secretsmanager:GetSecretValue")).map((s) => s.Resource));
    };
    expect(reads("api")).toMatch(/apiSettings/);
    expect(reads("api")).toMatch(/SignIn/);
    expect(reads("api")).not.toMatch(/workerSettings|DatabaseSecret/);
    expect(reads("worker")).toMatch(/workerSettings/);
    expect(reads("worker")).not.toMatch(/apiSettings|DatabaseSecret|SignIn/);
    expect(reads("migrate")).toMatch(/DatabaseSecret/);
    expect(reads("migrate")).not.toMatch(/Settings|SignIn/);
  });

  it("fills the database from InsForge with a task only a person can start", () => {
    // Postgres's own tools, running the script in database/, as the owner.
    expect(JSON.stringify(container("copy").Image)).toBe('"public.ecr.aws/docker/library/postgres:15"');
    expect((container("copy").Command as string[]).slice(0, 2)).toEqual(["bash", "-c"]);
    expect((container("copy").Command as string[])[2]).toContain("pg_restore");
    expect(names(container("copy").Secrets)).toEqual(["PGPASSWORD", "PGUSER", "SOURCE_URL"]);
    expect(names(container("copy").Environment)).toEqual(["PGDATABASE", "PGHOST", "PGPORT", "PGSSLMODE", "WORK_DIR"]);
    expect(container("copy")).toMatchObject({ ReadonlyRootFilesystem: true, MountPoints: [{ ContainerPath: "/work", ReadOnly: false }] });
    // InsForge's address lives in a secret that exists only while a copy runs: it is named
    // here and never created here, so no stack ever holds it.
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    const address = `arn:aws:secretsmanager:us-east-1:039612844713:secret:postsocial/${envName}/insforge-address`;
    expect((container("copy").Secrets as { Name: string; ValueFrom: string }[]).find((secret) => secret.Name === "SOURCE_URL")!.ValueFrom).toBe(address);
    // AWS reads a name ending in a hyphen and six characters as carrying its own suffix.
    expect(address).not.toMatch(/-[A-Za-z0-9]{6}$/);
    const policy = resources(template, "AWS::IAM::Policy").find((p) => JSON.stringify(p.Properties.Roles).includes("copyTaskExecutionRole"))!;
    const reads = JSON.stringify(statementsOf(policy).filter((s) => actionsOf(s).includes("secretsmanager:GetSecretValue")).map((s) => s.Resource));
    expect(reads).toContain(`${address}-??????`);
    expect(reads).toMatch(/DatabaseSecret/);
    expect(reads).not.toMatch(/Settings|AppLogin/);
    // A deploy from GitHub can neither run it nor hand it its roles.
    const deploy = resources(template, "AWS::IAM::Policy").find((p) => p.Properties.PolicyName === `postsocial-${envName}-deploy`)!;
    expect(JSON.stringify(statementsOf(deploy).filter((s) => actionsOf(s).some((action) => action === "ecs:RunTask" || action === "iam:PassRole")))).not.toMatch(/copy/i);
  });

  it("runs whichever build the deploy recorded, read from AWS rather than written here", () => {
    expect(template.toJSON().Parameters).toMatchObject({ [Object.keys(template.toJSON().Parameters).find((key) => key.startsWith("SsmParameterValue"))!]: { Type: "AWS::SSM::Parameter::Value<String>", Default: `/postsocial/${envName}/image-tag` } });
    for (const part of ["api", "worker", "migrate"]) expect(JSON.stringify(container(part).Image)).toMatch(/SsmParameterValue/);
    expect(JSON.stringify(container("copy").Image)).not.toMatch(/SsmParameterValue/);
    expect(JSON.stringify(container("api").Image)).toContain("apiImages");
    expect(JSON.stringify(container("worker").Image)).toContain("workerImages");
    expect(JSON.stringify(container("migrate").Image)).toContain("apiImages");
  });

  it("lets its own GitHub role roll these services and run this migration, nothing wider", () => {
    const policy = resources(template, "AWS::IAM::Policy").find((p) => p.Properties.PolicyName === `postsocial-${envName}-deploy`)!;
    expect(policy.Properties.Roles).toEqual([`postsocial-github-deploy-${envName}`]);
    const bySid = Object.fromEntries(statementsOf(policy).map((s) => [s.Sid, s]));
    expect(Object.keys(bySid).sort()).toEqual(["HandTasksTheirRoles", "NewTaskVersions", "ReadAndRollServices", "RunMigrations", "WatchTasks"]);
    expect(statementsOf(policy).flatMap(actionsOf).sort()).toEqual(["ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks", "ecs:RegisterTaskDefinition", "ecs:RunTask", "ecs:UpdateService", "iam:PassRole"]);
    // Only the two rights AWS can't narrow are on "*".
    expect(statementsOf(policy).filter((s) => s.Resource === "*").map((s) => s.Sid)).toEqual(["NewTaskVersions"]);
    expect(bySid.RunMigrations.Resource).toBe(`arn:aws:ecs:us-east-1:039612844713:task-definition/postsocial-${envName}-migrate:*`);
    expect(bySid.RunMigrations.Condition?.ArnEquals["ecs:cluster"]).toBeDefined();
    expect(bySid.WatchTasks.Condition?.ArnEquals["ecs:cluster"]).toBeDefined();
    expect(bySid.ReadAndRollServices.Resource).toHaveLength(2);
    // It can hand tasks this stack's six roles, and only to ECS tasks.
    expect(bySid.HandTasksTheirRoles.Resource).toHaveLength(6);
    expect(JSON.stringify(bySid.HandTasksTheirRoles.Resource)).not.toContain("*");
    expect(bySid.HandTasksTheirRoles.Condition).toEqual({ StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } });
  });

  it("gives the containers themselves no AWS rights, but for the way in's session channels", () => {
    const taskRoles = Object.keys(template.findResources("AWS::IAM::Role")).filter((id) => id.includes("TaskTaskRole"));
    expect(taskRoles).toHaveLength(5);
    // The one exception is checked in full under "looking at the data".
    for (const policy of resources(template, "AWS::IAM::Policy")) expect(JSON.stringify(policy.Properties.Roles)).not.toMatch(/(?<!tunnel)TaskTaskRole/);
    for (const role of resources(template, "AWS::IAM::Role")) expect(role.Properties.ManagedPolicyArns).toBeUndefined();
  });
});

describe("dev and prod services", () => {
  it("can't collide on the shared listener", () => {
    const priority = (envName: "dev" | "prod") => resources(services[envName], "AWS::ElasticLoadBalancingV2::ListenerRule")[0].Properties.Priority;
    expect(priority("dev")).not.toBe(priority("prod"));
  });

  it("reach only their own environment's database, secrets and logs", () => {
    expect(JSON.stringify(services.dev.toJSON())).not.toMatch(/PostSocialData-prod|postsocial-prod|\/postsocial\/prod\//);
    expect(JSON.stringify(services.prod.toJSON())).not.toMatch(/PostSocialData-dev|postsocial-dev|\/postsocial\/dev\//);
  });
});

describe("what protects prod, and what lets dev be rebuilt", () => {
  it("prod's database can't be deleted and survives its stack", () => {
    const [database] = resources(data.prod, "AWS::RDS::DBInstance");
    expect(database.Properties).toMatchObject({ DeletionProtection: true, BackupRetentionPeriod: 7, MultiAZ: false });
    expect(database.DeletionPolicy).toBe("Retain");
    expect(built.data.prod.terminationProtection).toBe(true);
    expect(built.services.prod.terminationProtection).toBe(true);
  });

  it("dev's database leaves a final snapshot when removed", () => {
    const [database] = resources(data.dev, "AWS::RDS::DBInstance");
    expect(database.Properties).toMatchObject({ DeletionProtection: false, BackupRetentionPeriod: 1 });
    expect(database.DeletionPolicy).toBe("Snapshot");
  });

  it("the shared stacks can't be deleted by mistake", () => {
    expect(built.foundation.terminationProtection).toBe(true);
    expect(built.edge.terminationProtection).toBe(true);
  });
});

describe("the nightly backup of prod's database", () => {
  const [definition] = resources(backup, "AWS::ECS::TaskDefinition");
  const containers = Object.fromEntries((definition.Properties.ContainerDefinitions as Record<string, unknown>[]).map((c) => [c.Name as string, c]));
  const names = (list: unknown) => (list as { Name: string }[]).map((item) => item.Name).sort();
  const policy = (name: string) => resources(backup, "AWS::IAM::Policy").find((p) => p.Properties.PolicyName === name || JSON.stringify(p.Properties.Roles).includes(name))!;

  it("exists for prod only", () => {
    expect(Object.keys(built.backups)).toEqual(["prod"]);
    expect(definition.Properties).toMatchObject({ Family: "postsocial-prod-backup", RequiresCompatibilities: ["FARGATE"], RuntimePlatform: { CpuArchitecture: "ARM64" } });
  });

  it("dumps with Postgres's own tools as the owner, read-only, and refuses a wiped database", () => {
    const dump = containers.dump;
    expect(JSON.stringify(dump.Image)).toBe('"public.ecr.aws/docker/library/postgres:15"');
    const script = (dump.Command as string[])[2];
    expect((dump.Command as string[]).slice(0, 2)).toEqual(["bash", "-c"]);
    expect(script).toContain("default_transaction_read_only=on");
    expect(script).toContain("pg_dump --format=custom");
    expect(script).toContain("auth.users is empty");
    expect(names(dump.Secrets)).toEqual(["PGPASSWORD", "PGUSER"]);
    expect(names(dump.Environment)).toEqual(["BACKUP_NAME", "MIN_BYTES", "MIN_PUBLIC_TABLES", "PGDATABASE", "PGHOST", "PGPORT", "PGSSLMODE", "WORK_DIR"]);
    expect(dump).toMatchObject({ ReadonlyRootFilesystem: true, Essential: false, MountPoints: [{ ContainerPath: "/work", ReadOnly: false }] });
  });

  it("uploads only a dump that passed its checks, with no database login of its own", () => {
    const upload = containers.upload;
    expect(JSON.stringify(upload.Image)).toMatch(/^"public\.ecr\.aws\/aws-cli\/aws-cli:2\.\d+\.\d+"$/);
    expect(upload.DependsOn).toEqual([{ ContainerName: "dump", Condition: "SUCCESS" }]);
    expect(upload.Secrets).toBeUndefined();
    expect(names(upload.Environment)).toEqual(["BACKUP_NAME", "BUCKET", "HOME", "WORK_DIR"]);
    expect((upload.Environment as { Name: string; Value: string }[]).find((e) => e.Name === "BUCKET")!.Value).toBe("postsocial-backups-039612844713");
    expect(upload).toMatchObject({ ReadonlyRootFilesystem: true, Essential: true });
    expect((upload.Command as string[])[0]).toContain('s3://$BUCKET/daily/');
  });

  it("lets the task add files to the two backup folders and nothing else", () => {
    const statements = statementsOf(policy("TaskTaskRole"));
    expect(statements).toHaveLength(1);
    expect(actionsOf(statements[0]).sort()).toEqual(["s3:AbortMultipartUpload", "s3:PutObject"]);
    expect(statements[0].Resource).toEqual(["arn:aws:s3:::postsocial-backups-039612844713/daily/*", "arn:aws:s3:::postsocial-backups-039612844713/monthly/*"]);
    // Only the owner login and the log stream for the run; no service settings.
    const reads = JSON.stringify(statementsOf(policy("TaskExecutionRole")).filter((s) => actionsOf(s).includes("secretsmanager:GetSecretValue")).map((s) => s.Resource));
    expect(reads).toMatch(/DatabaseSecret/);
    expect(reads).not.toMatch(/Settings|AppLogin|SignIn/);
  });

  it("is started by AWS every night, inside the network", () => {
    const nightly = resources(backup, "AWS::Events::Rule").find((r) => r.Properties.Name === "postsocial-prod-backup-nightly")!;
    expect(nightly.Properties.ScheduleExpression).toBe("cron(17 8 * * ? *)");
    const [target] = nightly.Properties.Targets as Record<string, unknown>[];
    expect(target.EcsParameters).toMatchObject({ LaunchType: "FARGATE", TaskCount: 1, NetworkConfiguration: { AwsVpcConfiguration: { AssignPublicIp: "ENABLED" } } });
    expect(JSON.stringify(target.EcsParameters)).toMatch(/ApiAccess/);
    expect(JSON.stringify(target.EcsParameters)).toMatch(/publicSubnet/);
  });

  it("sends a message to the alerts topic when a run fails or never starts", () => {
    const failed = resources(backup, "AWS::Events::Rule").find((r) => r.Properties.Name === "postsocial-prod-backup-failed")!;
    expect(failed.Properties.EventPattern).toMatchObject({
      source: ["aws.ecs"],
      "detail-type": ["ECS Task State Change"],
      detail: { group: ["family:postsocial-prod-backup"], lastStatus: ["STOPPED"], $or: [{ containers: { exitCode: [{ "anything-but": 0 }] } }, { stopCode: ["TaskFailedToStart"] }] },
    });
    backup.hasResourceProperties("AWS::SNS::Topic", { TopicName: "postsocial-prod-alerts" });
    expect(JSON.stringify((failed.Properties.Targets as unknown[])[0])).toMatch(/Alerts/);
    // Who receives it is added by hand: no address lives in the repository.
    backup.resourceCountIs("AWS::SNS::Subscription", 0);
    expect(JSON.stringify(backup.toJSON())).not.toMatch(/@[a-z0-9-]+\.(com|xyz)/i);
  });

  it("lets the GitHub backup role start this one task and watch it, nothing wider", () => {
    const rights = policy("postsocial-prod-backup-run");
    expect(rights.Properties.Roles).toEqual(["postsocial-github-backup"]);
    const bySid = Object.fromEntries(statementsOf(rights).map((s) => [s.Sid, s]));
    expect(Object.keys(bySid).sort()).toEqual(["HandTheTaskItsRoles", "ReadApiNetwork", "RunBackups", "WatchTasks"]);
    expect(statementsOf(rights).flatMap(actionsOf).sort()).toEqual(["ecs:DescribeServices", "ecs:DescribeTasks", "ecs:RunTask", "iam:PassRole"]);
    expect(bySid.RunBackups.Resource).toBe("arn:aws:ecs:us-east-1:039612844713:task-definition/postsocial-prod-backup:*");
    expect(bySid.RunBackups.Condition?.ArnEquals["ecs:cluster"]).toBeDefined();
    expect(bySid.WatchTasks.Condition?.ArnEquals["ecs:cluster"]).toBeDefined();
    expect(bySid.ReadApiNetwork.Resource).toBe("arn:aws:ecs:us-east-1:039612844713:service/postsocial/postsocial-prod-api");
    expect(bySid.HandTheTaskItsRoles.Resource).toHaveLength(2);
    expect(bySid.HandTheTaskItsRoles.Condition).toEqual({ StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } });
    expect(statementsOf(rights).filter((s) => s.Resource === "*")).toEqual([]);
    // A deploy from GitHub can't run a backup or hand it its roles.
    const deploy = resources(services.prod, "AWS::IAM::Policy").find((p) => p.Properties.PolicyName === "postsocial-prod-deploy")!;
    expect(JSON.stringify(statementsOf(deploy))).not.toMatch(/backup/i);
  });

  it("can't be deleted by mistake", () => {
    expect(built.backups.prod!.terminationProtection).toBe(true);
  });
});

describe("looking at the data from a person's own machine", () => {
  const containersOf = (template: Template, family: string) =>
    (resources(template, "AWS::ECS::TaskDefinition").find((definition) => definition.Properties.Family === family)!.Properties.ContainerDefinitions as Record<string, unknown>[])[0];
  const secretNames = (container: Record<string, unknown>) => ((container.Secrets as { Name: string }[] | undefined) ?? []).map((secret) => secret.Name);

  it.each(ENV_NAMES)("%s has a read-only login whose password is made up inside AWS and kept", (envName) => {
    const viewer = resources(data[envName], "AWS::SecretsManager::Secret").find((secret) => secret.Properties.Name === `postsocial/${envName}/database-viewer`)!;
    expect(viewer.Properties.GenerateSecretString).toMatchObject({ SecretStringTemplate: '{"username":"app_viewer"}', GenerateStringKey: "password", PasswordLength: 40 });
    expect(viewer.DeletionPolicy).toBe("Retain");
  });

  it.each(ENV_NAMES)("%s: only the migration task is handed that password, never the API or the worker", (envName) => {
    expect(secretNames(containersOf(services[envName], `postsocial-${envName}-migrate`))).toContain("DATABASE_VIEWER_PASSWORD");
    for (const part of ["api", "worker"]) expect(secretNames(containersOf(services[envName], `postsocial-${envName}-${part}`))).not.toContain("DATABASE_VIEWER_PASSWORD");
  });

  it.each(ENV_NAMES)("%s: the way in holds no login and no settings, only waits, and stops by itself", (envName) => {
    const tunnel = containersOf(services[envName], `postsocial-${envName}-tunnel`);
    expect(JSON.stringify(tunnel.Image)).toMatch(/^"public\.ecr\.aws\/docker\/library\/alpine:3\.\d+"$/);
    expect(tunnel.Command).toEqual(["sleep", "14400"]);
    expect(tunnel.Secrets).toBeUndefined();
    expect(tunnel.Environment).toBeUndefined();
    expect(tunnel.PortMappings).toBeUndefined();
    expect(tunnel.LinuxParameters).toMatchObject({ InitProcessEnabled: true });
  });

  it.each(ENV_NAMES)("%s: the task may talk to the session service and nothing else, and a deploy can't start it", (envName) => {
    const rights = resources(services[envName], "AWS::IAM::Policy").find((policy) => JSON.stringify(policy.Properties.Roles).includes("tunnelTaskTaskRole"))!;
    expect(statementsOf(rights)).toHaveLength(1);
    expect(actionsOf(statementsOf(rights)[0]).sort()).toEqual(["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]);
    const deploy = resources(services[envName], "AWS::IAM::Policy").find((policy) => policy.Properties.PolicyName === `postsocial-${envName}-deploy`)!;
    expect(JSON.stringify(statementsOf(deploy))).not.toMatch(/tunnel/i);
    // Nor does the task's start-up role read any secret.
    const startUp = resources(services[envName], "AWS::IAM::Policy").find((policy) => JSON.stringify(policy.Properties.Roles).includes("tunnelTaskExecutionRole"))!;
    expect(statementsOf(startUp).flatMap(actionsOf).filter((action) => action.startsWith("secretsmanager:"))).toEqual([]);
  });
});

describe("the uptime check", () => {
  const [checker] = resources(uptime, "AWS::Lambda::Function");
  const alarms = resources(uptime, "AWS::CloudWatch::Alarm");
  const checks = JSON.parse((checker.Properties.Environment as { Variables: { CHECKS: string } }).Variables.CHECKS) as { name: string; url: string; mustContain?: string }[];

  it("watches prod only: the website, the API through it, and the worker", () => {
    expect(Object.keys(built.uptime)).toEqual(["prod"]);
    expect(checks).toEqual([
      { name: "website", url: "https://www.postsocial.xyz/" },
      { name: "api", url: "https://www.postsocial.xyz/api/v1/openapi.json" },
      { name: "worker", url: "https://api.postsocial.xyz/readyz/worker", mustContain: '"ok":true' },
    ]);
  });

  it("is run by AWS every minute, with no retries piling up", () => {
    uptime.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(1 minute)", Targets: [Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 0 } })] });
    expect(checker.Properties).toMatchObject({ FunctionName: "postsocial-prod-uptime", Handler: "index.handler", Timeout: 30 });
  });

  it("holds no keys, sits outside our network, and may only write its own log", () => {
    expect(checker.Properties.VpcConfig).toBeUndefined();
    expect(Object.keys((checker.Properties.Environment as { Variables: Record<string, string> }).Variables).sort()).toEqual(["CHECKS", "ENVIRONMENT"]);
    const [role] = resources(uptime, "AWS::IAM::Role");
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    const statements = resources(uptime, "AWS::IAM::Policy").flatMap(statementsOf);
    expect(statements).toHaveLength(1);
    expect(actionsOf(statements[0]).sort()).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    expect(JSON.stringify(statements[0].Resource)).toMatch(/Logs/);
    uptime.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/postsocial/prod/uptime", RetentionInDays: 30 });
  });

  it("alerts after three bad minutes in a row, and treats a check that stopped as down", () => {
    expect(alarms.map((alarm) => alarm.Properties.AlarmName).sort()).toEqual(["postsocial-prod-api-down", "postsocial-prod-website-down", "postsocial-prod-worker-down"]);
    for (const alarm of alarms) {
      expect(alarm.Properties).toMatchObject({
        Namespace: "PostSocial/Uptime",
        MetricName: "Up",
        Statistic: "Minimum",
        Period: 60,
        ComparisonOperator: "LessThanThreshold",
        Threshold: 1,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        TreatMissingData: "breaching",
      });
    }
    // Each alarm reads the number its own check writes.
    const watched = alarms.map((alarm) => Object.fromEntries((alarm.Properties.Dimensions as { Name: string; Value: string }[]).map((d) => [d.Name, d.Value])));
    expect(watched.map((d) => d.Check).sort()).toEqual(checks.map((check) => check.name).sort());
    expect(watched.every((d) => d.Environment === "prod")).toBe(true);
  });

  it("sends both the alert and the recovery to the alerts topic, which lets our alarms in", () => {
    for (const alarm of alarms) {
      expect(JSON.stringify(alarm.Properties.AlarmActions)).toMatch(/PostSocialBackup-prod.*Alerts/);
      expect(alarm.Properties.OKActions).toEqual(alarm.Properties.AlarmActions);
    }
    const [topicPolicy] = resources(backup, "AWS::SNS::TopicPolicy");
    const ours = statementsOf(topicPolicy).find((s) => s.Sid === "OurAlarms") as Statement & { Principal: unknown };
    expect(ours.Principal).toEqual({ Service: "cloudwatch.amazonaws.com" });
    expect(ours.Condition).toEqual({ StringEquals: { "aws:SourceAccount": "039612844713" }, ArnLike: { "aws:SourceArn": "arn:aws:cloudwatch:us-east-1:039612844713:alarm:postsocial-prod-*" } });
    expect(alarms.every((alarm) => (alarm.Properties.AlarmName as string).startsWith("postsocial-prod-"))).toBe(true);
    uptime.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  it("can't be deleted by mistake", () => {
    expect(built.uptime.prod!.terminationProtection).toBe(true);
  });
});

describe("the overview dashboard and the other alarms", () => {
  // An alarm on one labelled number is written out as a one-item list; flatten it to read.
  type Watched = { MetricStat: { Metric: { Namespace: string; MetricName: string; Dimensions: { Name: string; Value: unknown }[] }; Period: number; Stat: string } };
  const flat = (properties: Record<string, unknown>) => {
    const [{ MetricStat: stat }] = properties.Metrics as Watched[];
    return { ...properties, Namespace: stat.Metric.Namespace, MetricName: stat.Metric.MetricName, Statistic: stat.Stat, Period: stat.Period, Dimensions: stat.Metric.Dimensions };
  };
  const alarms = Object.fromEntries(resources(monitoring, "AWS::CloudWatch::Alarm").map((alarm) => [alarm.Properties.AlarmName as string, flat(alarm.Properties) as Record<string, unknown>]));
  const dimensions = (alarm: Record<string, unknown>) => Object.fromEntries((alarm.Dimensions as { Name: string; Value: unknown }[]).map((d) => [d.Name, d.Value]));
  const [dashboard] = resources(monitoring, "AWS::CloudWatch::Dashboard");
  const body = JSON.stringify(dashboard.Properties.DashboardBody);

  it("alarms for prod only, and each one says when it starts and when it clears", () => {
    expect(Object.keys(alarms).sort()).toEqual(["postsocial-prod-api-errors", "postsocial-prod-api-no-healthy-copy", "postsocial-prod-database-cpu-high", "postsocial-prod-database-storage-low"]);
    for (const alarm of Object.values(alarms)) {
      expect(JSON.stringify(alarm.AlarmActions)).toMatch(/PostSocialBackup-prod.*Alerts/);
      expect(alarm.OKActions).toEqual(alarm.AlarmActions);
      expect(alarm.AlarmDescription).toMatch(/^Post Social prod: /);
    }
    monitoring.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  it("tells us when the API answers with server errors: 5 in 5 minutes, and silence is not an error", () => {
    const alarm = alarms["postsocial-prod-api-errors"];
    expect(alarm).toMatchObject({ Namespace: "AWS/ApplicationELB", MetricName: "HTTPCode_Target_5XX_Count", Statistic: "Sum", Period: 300, ComparisonOperator: "GreaterThanOrEqualToThreshold", Threshold: 5, EvaluationPeriods: 1, TreatMissingData: "notBreaching" });
    // Prod's own place behind the load balancer, not dev's.
    expect(JSON.stringify(dimensions(alarm).TargetGroup)).toMatch(/PostSocialServices-prod/);
    expect(JSON.stringify(dimensions(alarm).LoadBalancer)).toMatch(/PostSocialEdge/);
  });

  it("tells us when no API container is healthy for 2 minutes, or the count stops arriving", () => {
    const alarm = alarms["postsocial-prod-api-no-healthy-copy"];
    expect(alarm).toMatchObject({ MetricName: "HealthyHostCount", Statistic: "Minimum", Period: 60, ComparisonOperator: "LessThanThreshold", Threshold: 1, EvaluationPeriods: 2, TreatMissingData: "breaching" });
    expect(JSON.stringify(dimensions(alarm).TargetGroup)).toMatch(/PostSocialServices-prod/);
  });

  it("tells us when prod's database is short of disk or busy for 15 minutes", () => {
    const storage = alarms["postsocial-prod-database-storage-low"];
    expect(storage).toMatchObject({ Namespace: "AWS/RDS", MetricName: "FreeStorageSpace", Statistic: "Minimum", ComparisonOperator: "LessThanThreshold", Threshold: 4 * 1024 ** 3, Period: 300, EvaluationPeriods: 3 });
    const cpu = alarms["postsocial-prod-database-cpu-high"];
    expect(cpu).toMatchObject({ Namespace: "AWS/RDS", MetricName: "CPUUtilization", Statistic: "Average", ComparisonOperator: "GreaterThanThreshold", Threshold: 85, Period: 300, EvaluationPeriods: 3 });
    for (const alarm of [storage, cpu]) expect(dimensions(alarm)).toEqual({ DBInstanceIdentifier: "postsocial-prod" });
  });

  it("uses alarm names the alerts topic lets in", () => {
    const [topicPolicy] = resources(backup, "AWS::SNS::TopicPolicy");
    const pattern = (statementsOf(topicPolicy).find((s) => s.Sid === "OurAlarms")!.Condition!.ArnLike["aws:SourceArn"] as string).split(":alarm:")[1];
    expect(pattern).toBe("postsocial-prod-*");
    expect(Object.keys(alarms).every((name) => name.startsWith("postsocial-prod-"))).toBe(true);
  });

  it("shows prod and dev on one dashboard, with all seven alarms at the top", () => {
    expect(dashboard.Properties.DashboardName).toBe("postsocial-overview");
    monitoring.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    for (const name of ["website-down", "api-down", "worker-down", "api-errors", "api-no-healthy-copy", "database-storage-low", "database-cpu-high"]) expect(body).toContain(`alarm:postsocial-prod-${name}`);
    for (const envName of ENV_NAMES) {
      expect(body).toContain(`postsocial-${envName}-api`);
      expect(body).toContain(`postsocial-${envName}-worker`);
      expect(body).toMatch(new RegExp(`DBInstanceIdentifier[^a-z]+postsocial-${envName}`));
      expect(body).toContain(`PostSocialServices-${envName}`);
    }
    for (const metric of ["RequestCount", "HTTPCode_Target_5XX_Count", "TargetResponseTime", "CPUUtilization", "MemoryUtilization", "DatabaseConnections", "FreeStorageSpace", "PostSocial/Uptime"]) expect(body).toContain(metric);
  });

  it("can't be deleted by mistake", () => {
    expect(built.monitoring.terminationProtection).toBe(true);
  });
});

describe("load balancer", () => {
  it("is the only public door, HTTPS only", () => {
    edge.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
    edge.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internet-facing", Type: "application" });
    edge.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: "redirect", RedirectConfig: Match.objectLike({ Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" }) })],
    });
    edge.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
      DefaultActions: [Match.objectLike({ Type: "fixed-response", FixedResponseConfig: Match.objectLike({ StatusCode: "404" }) })],
    });
    const [group] = resources(edge, "AWS::EC2::SecurityGroup");
    const open = (group.Properties.SecurityGroupIngress as { FromPort: number }[]).map((r) => r.FromPort).sort();
    expect(open).toEqual([443, 80]);
  });

  it("has one certificate covering both API addresses", () => {
    edge.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "api.postsocial.xyz",
      SubjectAlternativeNames: ["api-dev.postsocial.xyz"],
      ValidationMethod: "DNS",
    });
  });
});

describe("everything", () => {
  it("is tagged as Post Social and holds no secret values", () => {
    for (const template of all) {
      const text = JSON.stringify(template.toJSON());
      expect(text).not.toMatch(/sk_live_|sk_test_|whsec_|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/);
    }
    foundation.hasResourceProperties("AWS::EC2::VPC", { Tags: Match.arrayWith([{ Key: "app", Value: "postsocial" }]) });
  });
});
