import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PlatformMark, Status } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import type { AutomationRow } from "./types";

export const metadata = { title: "Automations · Post Social" };

const count = (n: number) => n.toLocaleString("en-US");

// Inbox → Automations: every comment-to-DM automation with its numbers.
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const params = await searchParams;
  const { workspace } = await loadViewer("/beta/inbox/automations", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const data = await callServer<{ enabled: boolean; automations: AutomationRow[] }>("automations", { workspace_id: workspace.id });
  if (!data?.enabled) notFound();
  const canEdit = workspace.role !== "reviewer";
  const q = params.workspace ? `?workspace=${encodeURIComponent(params.workspace)}` : "";

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Automations</h1>
          <p className="mt-1 text-ps-muted">When someone comments a keyword on your Instagram post, they get a DM with your link.</p>
        </div>
        {canEdit && (
          <Link href={`/beta/inbox/automations/new${q}`} className="flex h-9 items-center rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover">
            New automation
          </Link>
        )}
      </div>

      {data.automations.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <p className="m-0 text-[15px] font-medium">No automations yet</p>
          <p className="mx-auto mt-1 max-w-[440px] text-ps-muted">
            Pick an Instagram post, a keyword like GUIDE and the link to send. Everyone who comments the keyword gets a DM with it.
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ps-line text-xs text-ps-subtle">
                <th className="px-4 py-2.5 font-normal">Automation</th>
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
                      <PlatformMark platform="instagram" size={18} />
                      <span className="flex flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-ps-subtle">
                          {a.account?.handle ? `@${a.account.handle}` : a.account?.display_name} · {a.platform_post_id ? "One post" : "Every post"}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ps-muted">{a.keywords.length ? a.keywords.map((k) => k.toUpperCase()).join(", ") : "Any comment"}</td>
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
