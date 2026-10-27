// Open sign-up: a person who signs up (email or Google) has no workspace yet. The first
// time they open the app, the web app asks for one and gets their own, on the Free plan.
// Anyone already in a workspace (invited, or provisioned before) gets that one back.
import { ApiError, type Caller, type Sql, isAgentCaller } from "./access";
import { SAMPLE_DRAFT } from "./sample-draft";
import { trackEvent } from "./telemetry";

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
      await addSampleDraft(sql, row.workspace_id, caller.userId);
      // The first step of the new-user funnel; the workspace lets test accounts be filtered out.
      trackEvent("signed_up", { workspace_id: row.workspace_id }, caller.userId);
      return { workspace_id: row.workspace_id };
    } catch (error) {
      if (attempt < 2 && /workspaces_slug|duplicate key/i.test(String((error as Error)?.message))) continue;
      throw error;
    }
  }
  throw new ApiError(500, "Setting up your workspace failed. Try again.");
}

// One example draft in a brand-new workspace, so Drafts and Create aren't empty on day one.
export { SAMPLE_DRAFT };

// Only in a workspace this person created in the last few minutes and that has no posts yet,
// so a returning or invited person never gets one. Best effort: sign-up never fails over it.
export async function addSampleDraft(sql: Sql, workspaceId: string, userId: string) {
  try {
    await sql(
      `INSERT INTO public.posts (workspace_id, actor_id, entry_point, caption, status, effective_approval_policy)
       SELECT w.id, a.id, 'ui', $3, 'draft', w.default_approval_policy
       FROM public.workspaces w
       JOIN public.actors a ON a.workspace_id = w.id AND a.user_id = $2 AND a.kind = 'user'
       WHERE w.id = $1 AND w.created_by = $2 AND w.created_at > now() - interval '10 minutes'
         AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.workspace_id = w.id)`,
      [workspaceId, userId, SAMPLE_DRAFT],
    );
  } catch {
    // The workspace is ready either way.
  }
}
