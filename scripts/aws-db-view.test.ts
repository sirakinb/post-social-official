// @vitest-environment node
import { describe, expect, it } from "vitest";
import { connectionDetails, LOCAL_PORTS, sessionParameters, sessionTarget, tablePlusUrl, tunnelState } from "./aws-db-view.mjs";

const taskArn = "arn:aws:ecs:us-east-1:039612844713:task/postsocial/0123456789abcdef0123456789abcdef";
const runtimeId = "0123456789abcdef0123456789abcdef-1234567890";
const agent = (lastStatus: string) => [{ name: "ExecuteCommandAgent", lastStatus }];

describe("when the way in is ready", () => {
  it("waits for both the task and the session agent inside it", () => {
    expect(tunnelState({})).toEqual({ state: "starting" });
    expect(tunnelState({ lastStatus: "PENDING", containers: [{ runtimeId }] })).toEqual({ state: "starting" });
    // The container runs a few seconds before the agent does.
    expect(tunnelState({ lastStatus: "RUNNING", containers: [{ runtimeId, managedAgents: agent("PENDING") }] })).toEqual({ state: "starting" });
    expect(tunnelState({ lastStatus: "RUNNING", containers: [{ runtimeId }] })).toEqual({ state: "starting" });
    expect(tunnelState({ lastStatus: "RUNNING", containers: [{ runtimeId, managedAgents: agent("RUNNING") }] })).toEqual({ state: "ready", runtimeId });
  });

  it("gives up, with AWS's reason, when the task stops instead", () => {
    expect(tunnelState({ lastStatus: "STOPPED", stoppedReason: "CannotPullContainerError" })).toEqual({ state: "failed", detail: "CannotPullContainerError" });
    expect(tunnelState({ lastStatus: "DEPROVISIONING", stopCode: "TaskFailedToStart" })).toEqual({ state: "failed", detail: "the task stopped" });
  });
});

describe("what the session is asked to carry", () => {
  it("names the container the way the session service expects", () => {
    expect(sessionTarget(taskArn, runtimeId)).toBe(`ecs:postsocial_0123456789abcdef0123456789abcdef_${runtimeId}`);
    expect(() => sessionTarget("not-a-task", runtimeId)).toThrow(/session service/);
    expect(() => sessionTarget(taskArn, "x; rm -rf")).toThrow(/session service/);
  });

  it("carries one local port to one of our databases, and to nothing else", () => {
    expect(sessionParameters({ host: "postsocial-prod.abc123.us-east-1.rds.amazonaws.com", port: 5432 }, 54320)).toEqual({
      host: ["postsocial-prod.abc123.us-east-1.rds.amazonaws.com"],
      portNumber: ["5432"],
      localPortNumber: ["54320"],
    });
    expect(() => sessionParameters({ host: "example.com", port: 5432 }, 54320)).toThrow(/database addresses/);
  });

  it("uses a different local port for dev and prod, so one is never mistaken for the other", () => {
    expect(LOCAL_PORTS.dev).not.toBe(LOCAL_PORTS.prod);
  });
});

describe("what it tells you to type", () => {
  it("is this machine's address and the read-only login, never a password", () => {
    const details = connectionDetails("prod", 54320);
    expect(details).toContain("127.0.0.1");
    expect(details).toContain("54320");
    expect(details).toContain("app_viewer");
    expect(details).toContain("Post Social prod (read-only)");
    expect(details).not.toMatch(/password/i);
  });

  it("opens TablePlus on this machine's end of the way in, as the read-only login, named by environment", () => {
    const url = new URL(tablePlusUrl("prod", 54320, "p@ss/w:rd"));
    expect([url.protocol, url.hostname, url.port, url.pathname, url.username]).toEqual(["postgresql:", "127.0.0.1", "54320", "/postsocial", "app_viewer"]);
    // Whatever the password holds, it stays one piece of the address.
    expect(decodeURIComponent(url.password)).toBe("p@ss/w:rd");
    expect(url.searchParams.get("name")).toBe("Post Social prod (read-only)");
    expect(url.searchParams.get("env")).toBe("production");
    // Left to TablePlus, which encrypts by itself; naming a mode stopped it connecting.
    expect(url.searchParams.has("tLSMode")).toBe(false);
    expect(new URL(tablePlusUrl("dev", 54321, "x")).searchParams.get("env")).toBe("development");
    expect(url.searchParams.get("statusColor")).not.toBe(new URL(tablePlusUrl("dev", 54321, "x")).searchParams.get("statusColor"));
  });
});
