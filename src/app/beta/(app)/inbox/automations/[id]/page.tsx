import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Status } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { AutomationForm } from "../automation-form";
import type { ActivityRow, AutomationRow } from "../types";
import { AutomationControls } from "./controls";

export const metadata = { title: "Automation · Post Social" };

const count = (n: number) => n.toLocaleString("en-US");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Tile(props: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-4">
      <p className="m-0 text-xs text-ps-subtle">{props.label}</p>
      <p className="m-0 mt-1 text-xl font-medium tabular-nums">{props.value}</p>
      {props.note && <p className="m-0 mt-0.5 text-xs text-ps-subtle">{props.note}</p>}
    </Card>
  );
}

const outcome: Record<ActivityRow["status"], { tone: "live" | "failed" | "quiet"; label: string }> = {
  sent: { tone: "live", label: "DM sent" },
  failed: { tone: "failed", label: "Didn't send" },
  skipped: { tone: "quiet", label: "Skipped" },
};

// The worker claims a comment as "skipped" with the reason "Sending" until the DM goes out
// (worker/src/inbox/runner.ts answerComment).
const sending = (r: ActivityRow) => r.status === "skipped" && r.reason === "Sending";

// One automation: its numbers, every comment it answered, and editing.
export default async function AutomationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ workspace?: string; edit?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { workspace } = await loadViewer(`/beta/inbox/automations/${id}`, query.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const data = await callServer<{ automation: AutomationRow; activity: ActivityRow[] }>("automation", { automation_id: id });
  if (!data) notFound();
  const { automation: a, activity } = data;
  const canEdit = workspace.role !== "reviewer";
  const ws = query.workspace ? `?workspace=${encodeURIComponent(query.workspace)}` : "";
  const back = `/beta/inbox/automations${ws}`;
  const editing = canEdit && query.edit === "1";
  const rate = a.sent && a.dm_buttons.length ? `${Math.round((a.people_clicked / a.sent) * 100)}% of people who got the DM` : undefined;

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <Link href={back} className="text-xs text-ps-subtle hover:text-ps-text">← Automations</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 flex items-center gap-2.5 text-lg font-medium">
            {a.name} {a.is_active ? <Status tone="live" label="On" /> : <Status tone="quiet" label="Paused" />}
          </h1>
          <p className="mt-1 text-ps-muted">
            {a.account?.handle ? `@${a.account.handle}` : a.account?.display_name} · {a.platform_post_id ? "One post" : "Every post"} ·{" "}
            {a.keywords.length ? `Keywords: ${a.keywords.map((k) => k.toUpperCase()).join(", ")}` : "Any comment"}
          </p>
        </div>
        {canEdit && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/beta/inbox/automations/${a.id}${ws ? `${ws}&` : "?"}edit=1`} className="flex h-9 items-center rounded-lg border border-ps-line-strong px-3 text-[13px] hover:border-ps-fg/30">Edit</Link>
            <AutomationControls id={a.id} active={a.is_active} backHref={back} />
          </div>
        )}
      </div>

      {editing ? (
        <AutomationForm workspaceId={workspace.id} accounts={[]} automation={a} backHref={back} />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Comments matched" value={count(a.triggered)} />
            <Tile label="DMs sent" value={count(a.sent)} note={a.failed ? `${count(a.failed)} didn't send` : undefined} />
            <Tile label="Link clicks" value={a.dm_buttons.length ? count(a.clicks) : "—"} note={a.dm_buttons.length ? undefined : "No link buttons"} />
            <Tile label="People who clicked" value={a.dm_buttons.length ? count(a.people_clicked) : "—"} note={rate} />
          </div>

          <Card className="mt-6 overflow-x-auto">
            <div className="border-b border-ps-line px-4 py-3">
              <h2 className="m-0 text-[13px] font-medium">Activity</h2>
            </div>
            {activity.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-ps-muted">Nothing yet. Comments that match show up here within seconds.</p>
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-ps-line text-xs text-ps-subtle">
                    <th className="px-4 py-2.5 font-normal">When</th>
                    <th className="px-4 py-2.5 font-normal">Comment</th>
                    <th className="px-4 py-2.5 font-normal">DM</th>
                    <th className="px-4 py-2.5 font-normal">Public reply</th>
                    <th className="px-4 py-2.5 text-right font-normal">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((r) => (
                    <tr key={r.id} className="border-b border-ps-line align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-ps-subtle">{when(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{r.commenter_username ? (a.account?.platform === "facebook" ? r.commenter_username : `@${r.commenter_username}`) : "Someone"}</span>{" "}
                        <span className="text-ps-muted">{r.comment_text}</span>
                      </td>
                      <td className="px-4 py-3">
                        {sending(r) ? (
                          <Status tone="quiet" label="Sending" />
                        ) : (
                          <>
                            <Status tone={outcome[r.status].tone} label={outcome[r.status].label} />
                            {r.reason && r.status !== "sent" && <p className="m-0 mt-1 text-xs text-ps-subtle">{r.reason}</p>}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ps-muted">{r.reply_status === "sent" ? "Posted" : r.reply_status === "failed" ? "Didn't post" : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
