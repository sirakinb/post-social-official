// @vitest-environment node
import { describe, expect, it } from "vitest";
import { backupOutcome, overridesFor } from "./aws-backup.mjs";

const stopped = (containers: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ lastStatus: "STOPPED", containers, ...extra });

describe("a backup run's result", () => {
  it("is still running until the task has stopped", () => {
    expect(backupOutcome({ lastStatus: "RUNNING", containers: [{ name: "dump", exitCode: 0 }] })).toEqual({ state: "running" });
    expect(backupOutcome({})).toEqual({ state: "running" });
  });

  it("is done only when both the dump and the upload ended without error", () => {
    expect(backupOutcome(stopped([{ name: "dump", exitCode: 0 }, { name: "upload", exitCode: 0 }]))).toEqual({ state: "done" });
    // Whatever order AWS lists them in.
    expect(backupOutcome(stopped([{ name: "upload", exitCode: 0 }, { name: "dump", exitCode: 0 }]))).toEqual({ state: "done" });
  });

  it("fails when the dump fails: the upload never starts, so it has no exit code", () => {
    expect(backupOutcome(stopped([{ name: "dump", exitCode: 1 }, { name: "upload" }]))).toEqual({ state: "failed", detail: "the dump step did not finish (exit code 1)" });
  });

  it("fails when the upload fails after a good dump", () => {
    expect(backupOutcome(stopped([{ name: "dump", exitCode: 0 }, { name: "upload", exitCode: 1 }]))).toEqual({ state: "failed", detail: "the upload step did not finish (exit code 1)" });
  });

  it("fails, with AWS's reason, when the task never ran", () => {
    expect(backupOutcome(stopped([{ name: "dump", reason: "CannotPullContainerError" }, { name: "upload" }]))).toEqual({ state: "failed", detail: "the dump step did not finish (CannotPullContainerError)" });
    expect(backupOutcome(stopped([], { stoppedReason: "Task failed to start" }))).toEqual({ state: "failed", detail: "the dump step did not finish (Task failed to start)" });
    expect(backupOutcome(stopped([]))).toEqual({ state: "failed", detail: "the dump step did not finish (it never ran)" });
  });
});

describe("what a run by hand changes", () => {
  it("is nothing by default, and only the monthly switch on the upload when asked", () => {
    expect(overridesFor({ monthly: false })).toEqual({});
    expect(overridesFor({ monthly: true })).toEqual({ containerOverrides: [{ name: "upload", environment: [{ name: "MONTHLY", value: "true" }] }] });
  });
});
