// What the templates must always say, whatever else changes: nothing public that shouldn't
// be, nothing deletable that mustn't be, and deploy roles that only the right branch can use.
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { buildApp } from "../lib/app";
import { ENV_NAMES, GITHUB_REPO } from "../lib/config";

const built = buildApp();
const foundation = Template.fromStack(built.foundation);
const edge = Template.fromStack(built.edge);
const data = { dev: Template.fromStack(built.data.dev), prod: Template.fromStack(built.data.prod) };
const all = [foundation, edge, data.dev, data.prod];

type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
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
      `repo:${GITHUB_REPO}:ref:refs/heads/main`,
      `repo:${GITHUB_REPO}:environment:Production`,
      `repo:${GITHUB_REPO}:environment:production`,
    ]);
  });

  it("lets only dev (and the Development environment) deploy dev", () => {
    expect(subjects("postsocial-github-deploy-dev")).toEqual([
      `repo:${GITHUB_REPO}:ref:refs/heads/dev`,
      `repo:${GITHUB_REPO}:environment:Development`,
      `repo:${GITHUB_REPO}:environment:development`,
    ]);
  });

  it("never trusts a wildcard, a pull request or another repository", () => {
    for (const name of ["postsocial-github-deploy-dev", "postsocial-github-deploy-prod"]) {
      for (const subject of subjects(name)) {
        expect(subject.startsWith(`repo:${GITHUB_REPO}:`)).toBe(true);
        expect(subject).not.toMatch(/\*|pull_request/);
      }
    }
  });

  it("can push images and nothing else", () => {
    const policies = resources(foundation, "AWS::IAM::Policy").filter((p) => JSON.stringify(p.Properties.Roles).includes("GitHubDeploy"));
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      const statements = (policy.Properties.PolicyDocument as { Statement: { Action: string | string[]; Effect: string }[] }).Statement;
      const actions = statements.flatMap((s) => s.Action);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.startsWith("ecr:") && !a.includes("*"))).toBe(true);
      expect(actions).not.toContain("ecr:DeleteRepository");
      expect(actions).not.toContain("ecr:BatchDeleteImage");
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
    expect(names).toEqual(expect.arrayContaining([`postsocial/${envName}/api`, `postsocial/${envName}/worker`, `postsocial/${envName}/database-admin`]));
    for (const service of ["api", "worker"]) {
      template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/${service}`, SecretString: "{}" });
    }
    // The owner password is generated inside AWS, never written here.
    template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: `postsocial/${envName}/database-admin`, GenerateSecretString: Match.anyValue() });
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

describe("what protects prod, and what lets dev be rebuilt", () => {
  it("prod's database can't be deleted and survives its stack", () => {
    const [database] = resources(data.prod, "AWS::RDS::DBInstance");
    expect(database.Properties).toMatchObject({ DeletionProtection: true, BackupRetentionPeriod: 7, MultiAZ: false });
    expect(database.DeletionPolicy).toBe("Retain");
    expect(built.data.prod.terminationProtection).toBe(true);
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
