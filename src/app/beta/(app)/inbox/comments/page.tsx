import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Status } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "../auto-refresh";
import { InboxNav, inboxAccounts, inboxQuery } from "../inbox-nav";
import { accountLabel } from "../account-label";
import { CommentActions, DeleteButton } from "./comment-actions";

export const metadata = { title: "Comments · Post Social" };

type Comment = {
  id: string;
  commenter_username: string | null;
  text: string | null;
  hidden: boolean;
  replied_at: string | null;
  dm_sent_at: string | null;
  can_dm: boolean;
  can_delete: boolean;
  replies: Array<{ id: string; text: string | null; created_at: string }> | null;
  created_at: string;
  post_caption: string | null;
  post_url: string | null;
  account: { platform?: string; handle: string | null; display_name: string };
  pending: Array<{ kind: string; status: "queued" | "failed"; error: string | null }> | null;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unreplied", label: "Unreplied" },
  { id: "hidden", label: "Hidden" },
] as const;
const PENDING_LABEL: Record<string, string> = { comment_reply: "Reply", private_reply: "DM", hide_comment: "Hiding", unhide_comment: "Unhiding", delete_comment: "Deleting" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; account?: string; filter?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/inbox/comments", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const filter = FILTERS.some((f) => f.id === params.filter) ? params.filter! : "all";
  const { accounts, account } = await inboxAccounts(client, workspace.id, params.account);
  const data = await callServer<{ comments: Comment[] }>("comments", { workspace_id: workspace.id, filter, ...(account ? { account_id: account } : {}) });
  if (!data) notFound();
  const canAct = workspace.role !== "reviewer";
  const href = (id: string) => `/beta/inbox/comments?${new URLSearchParams({ ...inboxQuery(params.workspace, account), ...(id === "all" ? {} : { filter: id }) })}`;

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <AutoRefresh seconds={10} />
      <InboxNav active="comments" workspace={params.workspace} accounts={accounts} account={account} />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Comments</h1>
          <p className="mt-1 text-ps-muted">Comments and replies on your Instagram, Facebook and Threads posts. Reply, DM the commenter, hide it or delete it.</p>
        </div>
        <nav aria-label="Filter" className="flex gap-1 rounded-lg border border-ps-line bg-ps-surface p-1 text-xs">
          {FILTERS.map((f) => (
            <Link key={f.id} href={href(f.id)} aria-current={f.id === filter ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", f.id === filter ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>{f.label}</Link>
          ))}
        </nav>
      </div>

      {data.comments.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-ps-muted">{filter === "all" ? "No comments yet. New comments on your Instagram, Facebook and Threads posts show up here within seconds." : "Nothing here."}</Card>
      ) : (
        <Card className="mt-6 divide-y divide-ps-line">
          {data.comments.map((c) => (
            <article key={c.id} className={cn("px-4 py-3", c.hidden && "opacity-60")}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{c.commenter_username ? `@${c.commenter_username}` : "Someone"}</span>
                <span className="text-xs text-ps-subtle">{when(c.created_at)} · on {c.post_url ? <a href={c.post_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.post_caption?.slice(0, 50) || "a post"}</a> : c.post_caption?.slice(0, 50) || "a post"} · {accountLabel(c.account)}</span>
                <span className="ml-auto flex gap-1.5">
                  {c.replied_at && <Status tone="live" label="Replied" />}
                  {c.dm_sent_at && <Status tone="live" label="DMed" />}
                  {c.hidden && <Status tone="quiet" label="Hidden" />}
                </span>
              </div>
              <p className="m-0 mt-1 whitespace-pre-wrap text-ps-text">{c.text}</p>
              {(c.pending ?? []).map((p, i) => (
                <p key={i} className={cn("m-0 mt-1 text-xs", p.status === "failed" ? "text-ps-failed-text" : "text-ps-subtle")}>
                  {PENDING_LABEL[p.kind] ?? "Change"}: {p.status === "failed" ? `didn't go through. ${p.error ?? ""}` : "sending…"}
                </p>
              ))}
              {(c.replies ?? []).map((r) => (
                <div key={r.id} className="mt-2 border-l border-ps-line pl-3 text-[13px]">
                  <span className="text-xs text-ps-subtle">Your reply · {when(r.created_at)}</span>
                  <p className="m-0 whitespace-pre-wrap text-ps-muted">{r.text}</p>
                  {canAct && c.can_delete && <span className="text-xs"><DeleteButton commentId={r.id} label="Delete reply" /></span>}
                </div>
              ))}
              {canAct && <CommentActions commentId={c.id} canDm={c.can_dm} canDelete={c.can_delete} hidden={c.hidden} replied={Boolean(c.replied_at)} />}
            </article>
          ))}
        </Card>
      )}
    </div>
  );
}
