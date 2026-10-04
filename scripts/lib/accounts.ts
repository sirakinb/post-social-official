// Creates Post Social accounts on InsForge: a sign-in user plus either a new workspace
// they own, or a reviewer seat in an existing workspace. Used by scripts/create-account.ts
// and the integration tests. Public sign-up is off, so this is the only way in.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Target = { name: "dev" | "prod"; baseUrl: string; adminKey: string };

export type AccountRequest =
  | { role: "owner"; email: string; displayName: string; password: string; workspaceName: string; workspaceSlug?: string }
  | { role: "reviewer"; email: string; displayName: string; password: string; workspaceSlug: string };

export type AccountResult = { userId: string; workspaceId: string; workspaceSlug: string; role: "owner" | "reviewer" };

const PASSWORD_MIN_LENGTH = 12; // keep in sync with [auth.password] in insforge.toml

export function resolveTarget(name: string, repoRoot: string): Target {
  if (name !== "dev" && name !== "prod") throw new Error('Target must be "dev" or "prod".');
  // The folder is linked to dev; the CLI keeps prod's link in project.parent.json.
  const file = name === "dev" ? "project.json" : "project.parent.json";
  const link = JSON.parse(readFileSync(path.join(repoRoot, ".insforge", file), "utf8")) as {
    project_name: string;
    oss_host: string;
    api_key: string;
  };
  const expected = name === "dev" ? "dev" : "post-social";
  if (link.project_name !== expected) {
    throw new Error(`.insforge/${file} points at "${link.project_name}", expected "${expected}". Run: npx -y @insforge/cli branch switch dev`);
  }
  return { name, baseUrl: link.oss_host, adminKey: link.api_key };
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export function validateRequest(request: AccountRequest): string[] {
  const problems: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)) problems.push("Email does not look valid.");
  if (!request.displayName.trim()) problems.push("Name is required.");
  if (request.password.length < PASSWORD_MIN_LENGTH) problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (!/[0-9]/.test(request.password)) problems.push("Password must include a number.");
  const slug = request.role === "owner" ? (request.workspaceSlug ?? slugify(request.workspaceName)) : request.workspaceSlug;
  if (request.role === "owner" && !request.workspaceName.trim()) problems.push("Workspace name is required.");
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) problems.push("Workspace address must be 2-63 lowercase letters, numbers or dashes.");
  return problems;
}

// One statement, so the workspace, membership, actor, plan and audit entry are created
// together or not at all.
export function ownerSetupSql(userId: string, request: Extract<AccountRequest, { role: "owner" }>) {
  const slug = request.workspaceSlug ?? slugify(request.workspaceName);
  return {
    slug,
    query: `
      WITH ws AS (
        INSERT INTO public.workspaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id
      ), member AS (
        INSERT INTO public.workspace_members (workspace_id, user_id, role) SELECT id, $3, 'owner' FROM ws
      ), actor AS (
        INSERT INTO public.actors (workspace_id, kind, user_id, display_name) SELECT id, 'user', $3, $4 FROM ws
      ), plan AS (
        INSERT INTO public.workspace_plans (workspace_id, plan_id) SELECT id, 'tester' FROM ws
      ), audit AS (
        INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary)
        SELECT id, 'system', 'workspace.created', 'workspace', id, $5 FROM ws
      )
      SELECT id AS workspace_id FROM ws`,
    params: [
      request.workspaceName.trim(),
      slug,
      userId,
      request.displayName.trim(),
      `Workspace created for ${request.email} by the admin account script`,
    ],
  };
}

export function reviewerSetupSql(userId: string, request: Extract<AccountRequest, { role: "reviewer" }>) {
  return {
    slug: request.workspaceSlug,
    query: `
      WITH ws AS (
        SELECT id FROM public.workspaces WHERE slug = $1
      ), member AS (
        INSERT INTO public.workspace_members (workspace_id, user_id, role) SELECT id, $2, 'reviewer' FROM ws
        RETURNING workspace_id
      ), actor AS (
        INSERT INTO public.actors (workspace_id, kind, user_id, display_name) SELECT id, 'user', $2, $3 FROM ws
      ), audit AS (
        INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary)
        SELECT id, 'system', 'member.added', 'workspace', id, $4 FROM ws
      )
      SELECT workspace_id FROM member`,
    params: [
      request.workspaceSlug,
      userId,
      request.displayName.trim(),
      `Reviewer ${request.email} added by the admin account script`,
    ],
  };
}

async function call<T>(target: Target, method: string, pathAndQuery: string, body?: unknown) {
  const response = await fetch(target.baseUrl + pathAndQuery, {
    method,
    headers: { Authorization: `Bearer ${target.adminKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }
  return { status: response.status, body: parsed as T };
}

async function sql<T>(target: Target, query: string, params: unknown[]) {
  const result = await call<{ rows: T[] }>(target, "POST", "/api/database/advance/rawsql", { query, params });
  if (result.status >= 300) throw new Error(`Database step failed (${result.status}): ${JSON.stringify(result.body)}`);
  return result.body.rows;
}

export async function createAccount(target: Target, request: AccountRequest): Promise<AccountResult> {
  const problems = validateRequest(request);
  if (problems.length) throw new Error(problems.join(" "));

  const slug = request.role === "owner" ? (request.workspaceSlug ?? slugify(request.workspaceName)) : request.workspaceSlug;
  const existing = await sql<{ id: string }>(target, "SELECT id FROM public.workspaces WHERE slug = $1", [slug]);
  if (request.role === "owner" && existing.length) throw new Error(`A workspace with the address "${slug}" already exists.`);
  if (request.role === "reviewer" && !existing.length) throw new Error(`No workspace with the address "${slug}".`);

  const created = await call<{ user?: { id: string } }>(target, "POST", "/api/auth/users?client_type=server", {
    email: request.email,
    password: request.password,
    name: request.displayName.trim(),
  });
  const userId = created.body?.user?.id;
  if (created.status >= 300 || !userId) {
    throw new Error(`Could not create the sign-in for ${request.email} (${created.status}). It may already exist.`);
  }

  try {
    const setup = request.role === "owner" ? ownerSetupSql(userId, request) : reviewerSetupSql(userId, request);
    const rows = await sql<{ workspace_id: string }>(target, setup.query, setup.params);
    if (!rows[0]?.workspace_id) throw new Error("Workspace setup returned nothing.");
    return { userId, workspaceId: rows[0].workspace_id, workspaceSlug: setup.slug, role: request.role };
  } catch (error) {
    // Do not leave a sign-in without a workspace behind.
    await call(target, "DELETE", "/api/auth/users", { userIds: [userId] });
    throw error;
  }
}
