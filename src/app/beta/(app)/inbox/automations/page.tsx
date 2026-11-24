import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Label, PlatformMark, Status } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import type { AutomationRow } from "./types";
import { InboxNav, inboxAccounts, inboxQuery } from "../inbox-nav";

export const metadata = { title: "Automations · Post Social" };

const count = (n: number) => n.toLocaleString("en-US");

// Inbox → Automations: every comment-to-DM automation with its numbers.
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; account?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/inbox/automations", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const { accounts, account } = await inboxAccounts(client, workspace.id, params.account);
  const data = await callServer<{ enabled: boolean; automations: AutomationRow[] }>("automations", { workspace_id: workspace.id, ...(account ? { account_id: account } : {}) });
  if (!data?.enabled) notFound();
  const canEdit = workspace.role !== "reviewer";
  const query = new URLSearchParams(inboxQuery(params.workspace, account)).toString();
  const q = query ? `?${query}` : "";

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <InboxNav active="automations" workspace={params.workspace} accounts={accounts} account={account} />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Automations</h1>
          <p className="mt-1 text-ps-muted">Someone comments your keyword, and they get your DM.</p>
        </div>
        {canEdit && (
          <Link href={`/beta/inbox/automations/new${q}`} className="flex h-9 items-center rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover">
            New automation
          </Link>
        )}
      </div>

      {data.automations.length === 0 ? (
        <Card className="mt-6">
          <div className="grid gap-px overflow-hidden rounded-t-xl bg-ps-line sm:grid-cols-3">
            {(
              [
                ["Pick a post", "Any post on your Instagram, Facebook or Threads account, or every post."],
                ["Choose a keyword", "A word like GUIDE that people comment to get your link."],
                ["Write the DM", "Everyone who comments it gets your message, with link buttons you can track."],
              ] as const
            ).map(([title, text], i) => (
              <div key={title} className="flex flex-col gap-1.5 bg-ps-surface p-5">
                <Label>{String(i + 1).padStart(2, "0")}</Label>
                <p className="m-0 text-[13px] font-medium">{title}</p>
                <p className="m-0 text-xs leading-relaxed text-ps-muted">{text}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ps-line px-5 py-4">
            <p className="m-0 text-ps-muted">No automations yet.</p>
            {canEdit && (
              <Link href={`/beta/inbox/automations/new${q}`} className="flex h-9 items-center rounded-lg border border-ps-line-strong px-3.5 text-[13px] hover:border-ps-fg/30">
                Create your first automation
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ps-line text-xs text-ps-subtle">
                <th className="px-4 py-2.5 font-normal">Automation</th>
                <th className="px-4 py-2.5 font-normal">On</th>
                <th className="px-4 py-2.5 font-normal">Keywords</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
                <th className="px-4 py-2.5 text-right font-normal">Comments</th>
                <th className="px-4 py-2.5 text-right font-normal">DMs sent</th>
                <th className="px-4 py-2.5 text-right font-normal">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {data.automations.map((a) => (
                <tr key={a.id} className="border-b border-ps-line last:border-0 hover:bg-ps-fg/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={`/beta/inbox/automations/${a.id}${q}`} className="flex items-center gap-2.5 text-ps-text hover:underline">
                      <PlatformMark platform={a.account?.platform === "facebook" || a.account?.platform === "threads" ? a.account.platform : "instagram"} size={18} />
                      <span className="flex flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-ps-subtle">{a.account?.handle ? `@${a.account.handle}` : a.account?.display_name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ps-muted">{a.platform_post_id ? "One post" : "Every post"}</td>
                  <td className="px-4 py-3">
                    {a.keywords.length ? <span className="font-mono text-xs tracking-wide text-ps-text">{a.keywords.map((k) => k.toUpperCase()).join(", ")}</span> : <span className="text-ps-muted">Any comment</span>}
                  </td>
                  <td className="px-4 py-3">{a.is_active ? <Status tone="live" label="On" /> : <Status tone="quiet" label="Paused" />}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{count(a.triggered)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {count(a.sent)}
                    {a.failed > 0 && <span className="ml-1.5 text-xs text-ps-failed-text">{count(a.failed)} failed</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.dm_buttons.length ? count(a.clicks) : <span className="text-ps-subtle">No links</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
