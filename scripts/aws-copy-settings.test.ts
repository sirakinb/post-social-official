// @vitest-environment node
import { describe, expect, it } from "vitest";
import { merge, plan, WORKER_REQUIRED } from "./aws-copy-settings.mjs";

const secret = (key: string, extra: Record<string, unknown> = {}) => ({ key, isReserved: false, isActive: true, ...extra });
const insforge = [
  ...["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CREDENTIAL_ENCRYPTION_KEY", "WEB_APP_HOME", "PUBLISH_ALLOWLIST", "STRIPE_SECRET_KEY", "META_APP_SECRET", "X_CLIENT_ID", "APP_ENV", "CONNECTIONS_BASE_URL"].map((key) => secret(key)),
  ...["API_KEY", "ANON_KEY", "JWT_SECRET", "JWT_PRIVATE_KEY", "INSFORGE_BASE_URL"].map((key) => secret(key, { isReserved: true })),
  secret("OLD_KEY", { isActive: false }),
];

describe("plan", () => {
  const { api, worker, missing } = plan("dev", insforge);

  it("never copies the keys that open InsForge itself", () => {
    for (const name of ["API_KEY", "ANON_KEY", "JWT_SECRET", "JWT_PRIVATE_KEY"]) {
      expect(api).not.toContain(name);
      expect(worker).not.toContain(name);
    }
  });

  it("gives the API our own settings plus InsForge's address for sign-in checks, and leaves out what AWS sets", () => {
    expect(api).toEqual(["CREDENTIAL_ENCRYPTION_KEY", "INSFORGE_BASE_URL", "META_APP_SECRET", "PUBLISH_ALLOWLIST", "R2_ACCESS_KEY_ID", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_SECRET_ACCESS_KEY", "STRIPE_SECRET_KEY", "WEB_APP_HOME", "X_CLIENT_ID"]);
    expect(api).not.toContain("OLD_KEY");
  });

  it("gives the worker only what it reads: no Stripe key, no InsForge address", () => {
    expect(worker).toEqual(["CREDENTIAL_ENCRYPTION_KEY", "PUBLISH_ALLOWLIST", "R2_ACCESS_KEY_ID", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_SECRET_ACCESS_KEY", "WEB_APP_HOME", "X_CLIENT_ID"]);
    expect(missing).toEqual([]);
  });

  it("stops when something the services can't start without is missing", () => {
    const without = (name: string) => insforge.filter((item) => item.key !== name);
    expect(plan("dev", without("CREDENTIAL_ENCRYPTION_KEY")).missing).toEqual(["api: CREDENTIAL_ENCRYPTION_KEY", "worker: CREDENTIAL_ENCRYPTION_KEY"]);
    // Dev's worker must know which test accounts it may publish to; prod has no such list.
    expect(plan("dev", without("PUBLISH_ALLOWLIST")).missing).toEqual(["worker: PUBLISH_ALLOWLIST"]);
    expect(plan("prod", without("PUBLISH_ALLOWLIST")).missing).toEqual([]);
    expect(WORKER_REQUIRED).toContain("CREDENTIAL_ENCRYPTION_KEY");
  });
});

describe("merge", () => {
  it("keeps what only AWS has, and takes InsForge's value for the rest", () => {
    const result = merge({ AWS_ONLY: "keep", SAME: "x", STALE: "old" }, { SAME: "x", STALE: "new", FRESH: "y" });
    expect(result.value).toEqual({ AWS_ONLY: "keep", SAME: "x", STALE: "new", FRESH: "y" });
    expect(result).toMatchObject({ kept: ["AWS_ONLY"], changed: ["STALE"], added: ["FRESH"] });
  });
});
