// @vitest-environment node
import { describe, expect, it } from "vitest";
import { networkOf, nextTaskDefinition, rolloutState, taskOutcome } from "./aws-deploy.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const REGISTRY = "039612844713.dkr.ecr.us-east-1.amazonaws.com";

const current = {
  taskDefinitionArn: "arn:aws:ecs:us-east-1:039612844713:task-definition/postsocial-dev-api:7",
  revision: 7,
  status: "ACTIVE",
  requiresAttributes: [{ name: "ecs.capability.execution-role-ecr-pull" }],
  compatibilities: ["EC2", "FARGATE"],
  registeredAt: "2026-11-25T00:00:00Z",
  registeredBy: "arn:aws:sts::039612844713:assumed-role/x/y",
  family: "postsocial-dev-api",
  cpu: "256",
  memory: "512",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  runtimePlatform: { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" },
  executionRoleArn: "arn:aws:iam::039612844713:role/exec",
  taskRoleArn: "arn:aws:iam::039612844713:role/task",
  containerDefinitions: [{ name: "api", image: `${REGISTRY}/postsocial/api:${OLD}`, secrets: [{ name: "SETTINGS_JSON", valueFrom: "arn:aws:secretsmanager:us-east-1:039612844713:secret:postsocial/dev/api-AbCdEf" }], environment: [{ name: "APP_ENV", value: "dev" }] }],
};

describe("nextTaskDefinition", () => {
  it("changes the image's tag and nothing else AWS would accept back", () => {
    const next = nextTaskDefinition(current, NEW);
    expect(next.containerDefinitions).toEqual([{ ...current.containerDefinitions[0], image: `${REGISTRY}/postsocial/api:${NEW}` }]);
    expect(next).toMatchObject({ family: "postsocial-dev-api", cpu: "256", memory: "512", executionRoleArn: current.executionRoleArn, taskRoleArn: current.taskRoleArn, runtimePlatform: current.runtimePlatform });
    for (const key of ["taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities", "registeredAt", "registeredBy"]) expect(key in next).toBe(false);
    // The task definition it was given is left as it was.
    expect(current.containerDefinitions[0].image).toBe(`${REGISTRY}/postsocial/api:${OLD}`);
  });

  it("only accepts a full commit SHA", () => {
    for (const bad of ["latest", "abc123", `${NEW}; rm -rf /`, NEW.toUpperCase(), ""]) expect(() => nextTaskDefinition(current, bad)).toThrow(/commit SHA/);
  });

  it("refuses a task that runs anything but our own images", () => {
    for (const image of ["docker.io/library/node:24", `${REGISTRY}/other/api:${OLD}`, `evil.example/postsocial/api:${OLD}`, `${REGISTRY}/postsocial/api`]) {
      expect(() => nextTaskDefinition({ ...current, containerDefinitions: [{ name: "api", image }] }, NEW)).toThrow(/Post Social image/);
    }
    expect(() => nextTaskDefinition({ ...current, containerDefinitions: [...current.containerDefinitions, { name: "sidecar", image: "x" }] }, NEW)).toThrow(/one container/);
  });
});

describe("rolloutState", () => {
  const arn = "arn:aws:ecs:us-east-1:039612844713:task-definition/postsocial-dev-api:8";
  const primary = (extra: Record<string, unknown>) => ({ status: "PRIMARY", taskDefinition: arn, desiredCount: 2, runningCount: 2, rolloutState: "COMPLETED", ...extra });

  it("is done only when the new build is the only one and fully running", () => {
    expect(rolloutState({ deployments: [primary({})] }, arn).state).toBe("done");
    expect(rolloutState({ deployments: [primary({ rolloutState: "IN_PROGRESS", runningCount: 1 })] }, arn)).toEqual({ state: "running", detail: "1 of 2 running" });
    expect(rolloutState({ deployments: [primary({}), { status: "ACTIVE", taskDefinition: "old" }] }, arn).state).toBe("running");
    expect(rolloutState({ deployments: [] }, arn).state).toBe("running");
  });

  it("fails when AWS went back to the old build, or says the rollout failed", () => {
    expect(rolloutState({ deployments: [primary({ taskDefinition: "arn:old" })] }, arn)).toMatchObject({ state: "failed", detail: expect.stringMatching(/previous build/) });
    expect(rolloutState({ deployments: [primary({ rolloutState: "FAILED", rolloutStateReason: "ECS deployment circuit breaker: tasks failed to start." })] }, arn)).toEqual({ state: "failed", detail: "ECS deployment circuit breaker: tasks failed to start." });
  });
});

describe("taskOutcome", () => {
  it("passes only on exit code 0", () => {
    expect(taskOutcome({ lastStatus: "RUNNING" })).toEqual({ state: "running" });
    expect(taskOutcome({ lastStatus: "STOPPED", containers: [{ exitCode: 0 }] })).toEqual({ state: "done" });
    expect(taskOutcome({ lastStatus: "STOPPED", containers: [{ exitCode: 1 }] })).toEqual({ state: "failed", detail: "exit code 1" });
  });

  it("says why a task never ran", () => {
    expect(taskOutcome({ lastStatus: "STOPPED", stoppedReason: "ResourceInitializationError: unable to pull secrets", containers: [{}] })).toEqual({ state: "failed", detail: "ResourceInitializationError: unable to pull secrets" });
    expect(taskOutcome({ lastStatus: "STOPPED" })).toEqual({ state: "failed", detail: "it stopped without running" });
  });
});

describe("networkOf", () => {
  it("borrows the API service's subnets and firewall group for the migration task", () => {
    const service = { networkConfiguration: { awsvpcConfiguration: { subnets: ["subnet-1", "subnet-2"], securityGroups: ["sg-1"], assignPublicIp: "ENABLED" } } };
    expect(networkOf(service)).toEqual({ awsvpcConfiguration: { subnets: ["subnet-1", "subnet-2"], securityGroups: ["sg-1"], assignPublicIp: "ENABLED" } });
    expect(() => networkOf({})).toThrow(/network settings/);
  });
});
