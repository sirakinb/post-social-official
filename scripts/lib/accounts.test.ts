import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ownerSetupSql, resolveTarget, reviewerSetupSql, slugify, validateRequest } from "./accounts";

const owner = {
  role: "owner" as const,
  email: "aki@example.com",
  displayName: "Aki",
  password: "long-enough-1",
  workspaceName: "Pentridge Media",
};

describe("slugify", () => {
  it("makes a workspace address from a name", () => {
    expect(slugify("Pentridge Media")).toBe("pentridge-media");
    expect(slugify("  Café & Co.  ")).toBe("cafe-co");
    expect(slugify("a".repeat(80))).toHaveLength(63);
  });
});

describe("validateRequest", () => {
  it("accepts a valid owner request", () => {
    expect(validateRequest(owner)).toEqual([]);
  });

  it("lists every problem in plain language", () => {
    const problems = validateRequest({ ...owner, email: "nope", password: "short", workspaceName: "!" });
    expect(problems).toEqual([
      "Email does not look valid.",
      "Password must be at least 12 characters.",
      "Password must include a number.",
      "Workspace address must be 2-63 lowercase letters, numbers or dashes.",
    ]);
  });

  it("requires an existing workspace address for reviewers", () => {
    expect(
      validateRequest({ role: "reviewer", email: "r@example.com", displayName: "R", password: "long-enough-1", workspaceSlug: "" }),
    ).toContain("Workspace address must be 2-63 lowercase letters, numbers or dashes.");
  });
});

describe("setup SQL", () => {
  it("passes every value as a parameter, never inside the SQL text", () => {
    const sneaky = { ...owner, workspaceName: "x'); DROP TABLE public.posts; --", displayName: "Robert'); --" };
    const setup = ownerSetupSql("user-1", sneaky);
    expect(setup.query).not.toContain("DROP TABLE");
    expect(setup.query).not.toContain("Robert");
    expect(setup.params).toContain("Robert'); --");

    const reviewer = reviewerSetupSql("user-2", {
      role: "reviewer",
      email: "r@example.com",
      displayName: "Reviewer",
      password: "long-enough-1",
      workspaceSlug: "pentridge-media",
    });
    expect(reviewer.query).toContain("'reviewer'");
    expect(reviewer.params[0]).toBe("pentridge-media");
  });
});

describe("resolveTarget", () => {
  function repoWith(files: Record<string, object>) {
    const root = mkdtempSync(path.join(tmpdir(), "accounts-"));
    mkdirSync(path.join(root, ".insforge"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, ".insforge", name), JSON.stringify(content));
    }
    return root;
  }

  it("reads dev from project.json and prod from project.parent.json", () => {
    const root = repoWith({
      "project.json": { project_name: "dev", oss_host: "https://dev.example", api_key: "dev-key" },
      "project.parent.json": { project_name: "post-social", oss_host: "https://prod.example", api_key: "prod-key" },
    });
    expect(resolveTarget("dev", root)).toEqual({ name: "dev", baseUrl: "https://dev.example", adminKey: "dev-key" });
    expect(resolveTarget("prod", root)).toEqual({ name: "prod", baseUrl: "https://prod.example", adminKey: "prod-key" });
  });

  it("refuses when the folder is linked somewhere unexpected", () => {
    const root = repoWith({ "project.json": { project_name: "post-social", oss_host: "x", api_key: "k" } });
    expect(() => resolveTarget("dev", root)).toThrow(/expected "dev"/);
    expect(() => resolveTarget("staging", root)).toThrow(/dev" or "prod/);
  });
});
