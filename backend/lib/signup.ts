// Open sign-up: a person who signs up (email or Google) has no workspace yet. The first
// time they open the app, the web app asks for one and gets their own, on the Free plan.
// Anyone already in a workspace (invited, or provisioned before) gets that one back.
import { ApiError, type Caller, type Sql, isAgentCaller } from "./access";

// Same shape as workspace addresses made by the account script.
export function slugBase(text: string) {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "workspace";
}

export function workspaceNameFor(displayName: string) {
  const name = displayName.trim().slice(0, 60);
  return name ? `${name}'s workspace` : "My workspace";
}

const randomSuffix = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function provisionWorkspace(sql: Sql, caller: Caller, _input: Record<string, unknown> = {}, suffix = randomSuffix) {
  if (isAgentCaller(caller)) throw new ApiError(403, "Only a signed-in person can create their workspace.");
  const name = workspaceNameFor(caller.displayName);
  // The suffix keeps addresses unique without a lookup; a clash (vanishingly rare) is retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${slugBase(caller.displayName)}-${suffix()}`;
    try {
      const [row] = await sql<{ workspace_id: string }>(
        `SELECT public.provision_owner_workspace($1, $2, $3, $4, $5) AS workspace_id`,
        [caller.userId, name, slug, caller.displayName.trim() || "Owner", "Workspace created at sign-up"],
      );
      if (!row?.workspace_id) throw new ApiError(500, "Setting up your workspace failed. Try again.");
      return { workspace_id: row.workspace_id };
    } catch (error) {
      if (attempt < 2 && /workspaces_slug|duplicate key/i.test(String((error as Error)?.message))) continue;
      throw error;
    }
  }
  throw new ApiError(500, "Setting up your workspace failed. Try again.");
}
