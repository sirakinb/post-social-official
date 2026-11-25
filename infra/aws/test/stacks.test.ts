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
const all = [foundation, edge, data.dev, data.prod, services.dev, services.prod];

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
    expect(names.sort()).toEqual([`postsocial/${envName}/api`, `postsocial/${envName}/database-admin`, `postsocial/${envName}/database-app`, `postsocial/${envName}/worker`]);
    for (const service of ["api", "worker"]) {
      template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/${service}`, SecretString: "{}" });
    }
    // Both database passwords are generated inside AWS, never written here.
    for (const login of ["database-admin", "database-app"]) {
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

  it("runs the API, the worker and the two database tasks on ARM64 Fargate", () => {
    expect(Object.keys(definitions).sort()).toEqual(["api", "copy", "migrate", "worker"].map((part) => `postsocial-${envName}-${part}`));
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

  it("never runs two workers at once, and none on dev while dev's worker is still on InsForge", () => {
    expect(service("worker").Properties).toMatchObject({
      DesiredCount: envName === "prod" ? 1 : 0,
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
      expect(names(secrets)).toEqual(["DATABASE_PASSWORD", "SETTINGS_JSON"]);
      expect(JSON.stringify(secrets.find((s) => s.Name === "SETTINGS_JSON")!.ValueFrom)).toContain(`${part}Settings`);
      expect(JSON.stringify(secrets.find((s) => s.Name === "DATABASE_PASSWORD")!.ValueFrom)).toMatch(/AppLogin.*:password::/);
      const plain = names(container(part).Environment);
      expect(plain).toEqual(["APP_ENV", "CONNECTIONS_BASE_URL", "DATABASE_HOST", "DATABASE_NAME", "DATABASE_PORT", "PORT"]);
      expect(container(part).Environment).toEqual(expect.arrayContaining([
        { Name: "APP_ENV", Value: envName === "prod" ? "production" : "dev" },
        { Name: "CONNECTIONS_BASE_URL", Value: `https://${domain}/connections` },
        { Name: "DATABASE_NAME", Value: "postsocial" },
      ]));
    }
    // The running services never hold the database owner's login.
    for (const part of ["api", "worker"]) expect(JSON.stringify(container(part))).not.toMatch(/DATABASE_OWNER|DatabaseSecret/);
  });

  it("keeps the owner login to the migration task", () => {
    expect(container("migrate").Command).toEqual(["node", "migrate.mjs", "--bootstrap"]);
    expect(names(container("migrate").Secrets)).toEqual(["DATABASE_OWNER_PASSWORD", "DATABASE_OWNER_USERNAME", "DATABASE_PASSWORD"]);
    expect(names(container("migrate").Environment)).toEqual(["DATABASE_HOST", "DATABASE_NAME", "DATABASE_PORT"]);
    expect(JSON.stringify(container("migrate").Secrets)).not.toContain("Settings");
    // Each task can read its own secrets and no other's.
    const reads = (part: string) => {
      const policy = resources(template, "AWS::IAM::Policy").find((p) => JSON.stringify(p.Properties.Roles).includes(`${part}TaskExecutionRole`))!;
      return JSON.stringify(statementsOf(policy).filter((s) => actionsOf(s).includes("secretsmanager:GetSecretValue")).map((s) => s.Resource));
    };
    expect(reads("api")).toMatch(/apiSettings/);
    expect(reads("api")).not.toMatch(/workerSettings|DatabaseSecret/);
    expect(reads("worker")).toMatch(/workerSettings/);
    expect(reads("worker")).not.toMatch(/apiSettings|DatabaseSecret/);
    expect(reads("migrate")).toMatch(/DatabaseSecret/);
    expect(reads("migrate")).not.toMatch(/Settings/);
  });

  it("fills the database from InsForge with a task only a person can start", () => {
    // Postgres's own tools, running the script in database/, as the owner.
    expect(JSON.stringify(container("copy").Image)).toBe('"public.ecr.aws/docker/library/postgres:15"');
    expect((container("copy").Command as string[]).slice(0, 2)).toEqual(["bash", "-c"]);
    expect((container("copy").Command as string[])[2]).toContain("pg_restore");
    expect(names(container("copy").Secrets)).toEqual(["PGPASSWORD", "PGUSER", "SOURCE_URL"]);
    expect(names(container("copy").Environment)).toEqual(["PGDATABASE", "PGHOST", "PGPORT", "PGSSLMODE", "WORK_DIR"]);
    expect(container("copy")).toMatchObject({ ReadonlyRootFilesystem: true, MountPoints: [{ ContainerPath: "/work", ReadOnly: false }] });
    // InsForge's address is never written here: the secret starts as a placeholder.
    template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/copy-source`, SecretString: "not set" });
    const policy = resources(template, "AWS::IAM::Policy").find((p) => JSON.stringify(p.Properties.Roles).includes("copyTaskExecutionRole"))!;
    const reads = JSON.stringify(statementsOf(policy).filter((s) => actionsOf(s).includes("secretsmanager:GetSecretValue")).map((s) => s.Resource));
    expect(reads).toMatch(/CopySource/);
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

  it("gives the containers themselves no AWS rights", () => {
    const taskRoles = Object.keys(template.findResources("AWS::IAM::Role")).filter((id) => id.includes("TaskTaskRole"));
    expect(taskRoles).toHaveLength(4);
    for (const policy of resources(template, "AWS::IAM::Policy")) expect(JSON.stringify(policy.Properties.Roles)).not.toMatch(/TaskTaskRole/);
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
