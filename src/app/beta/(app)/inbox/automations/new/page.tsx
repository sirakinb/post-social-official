import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { AutomationForm } from "../automation-form";
import type { AccountOption } from "../types";

export const metadata = { title: "New automation · Post Social" };

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/inbox/automations/new", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const status = await callServer<{ enabled: boolean }>("inbox_status", { workspace_id: workspace.id });
  if (!status?.enabled || workspace.role === "reviewer") notFound();
  const { data } = await client.database.from("connected_accounts").select("id, handle, display_name").eq("workspace_id", workspace.id).eq("platform", "instagram").neq("health", "disconnected").order("display_name");
  const accounts = (data ?? []) as AccountOption[];
  const back = `/beta/inbox/automations${params.workspace ? `?workspace=${encodeURIComponent(params.workspace)}` : ""}`;

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <Link href={back} className="text-xs text-ps-subtle hover:text-ps-text">← Automations</Link>
      <h1 className="m-0 mt-2 text-lg font-medium">New automation</h1>
      <p className="mt-1 text-ps-muted">Someone comments your keyword, and they get your DM.</p>
      {accounts.length ? (
        <AutomationForm workspaceId={workspace.id} accounts={accounts} backHref={back} />
      ) : (
        <Card className="mt-6 p-8 text-center">
          <p className="m-0 text-[15px] font-medium">Connect an Instagram account first</p>
          <p className="mt-1 text-ps-muted">Automations answer comments on Instagram Business and Creator accounts.</p>
          <Link href="/beta/accounts" className="mt-3 inline-flex h-9 items-center rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground">Go to Accounts</Link>
        </Card>
      )}
    </div>
  );
}
