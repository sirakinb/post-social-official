import { IdentifyViewer } from "@/components/analytics/identify";
import { Sidebar } from "@/components/beta/sidebar";
import { loadViewer } from "@/lib/beta/workspace";
import { signOut } from "../actions";
import { analyticsEnabled } from "./stats-switch";

// The signed-in app: the sidebar on every page, the page beside it.
export default async function BetaAppLayout({ children }: { children: React.ReactNode }) {
  const { viewer, workspace, client } = await loadViewer("/beta");

  let plan: { name: string; used: number; limit: number; resets: string } | null = null;
  if (workspace) {
    const [{ data: planRow }, { data: usage }] = await Promise.all([
      client.database.from("workspace_plans").select("plans(name, max_posts_per_month)").eq("workspace_id", workspace.id).maybeSingle(),
      client.database.rpc("workspace_usage", { target_workspace: workspace.id }),
    ]);
    const p = (planRow as { plans: { name: string; max_posts_per_month: number } | null } | null)?.plans;
    const published = ((usage ?? []) as Array<{ event_type: string; quantity: number }>).find((u) => u.event_type === "post_published");
    const now = new Date();
    const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    if (p) plan = { name: p.name, used: Number(published?.quantity ?? 0), limit: p.max_posts_per_month, resets };
  }

  return (
    // data-ph-mask: session replays hide this app's text and pictures (instrumentation-client.ts).
    <div data-ph-mask className="flex min-h-screen flex-col bg-ps-ground font-sans text-[13px] text-ps-text md:flex-row">
      <IdentifyViewer userId={viewer.id} role={workspace?.role ?? "member"} />
      <Sidebar
        workspaceName={workspace?.name ?? "Post Social"}
        viewer={{ name: viewer.name, avatarUrl: viewer.avatarUrl, role: workspace?.role ?? "member" }}
        plan={plan}
        statsEnabled={analyticsEnabled()}
        signOut={signOut}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
