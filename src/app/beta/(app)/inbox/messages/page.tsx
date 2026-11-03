import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "../auto-refresh";
import { InboxNav, inboxAccounts, inboxQuery } from "../inbox-nav";
import { accountLabel } from "../account-label";
import { Composer, DoneButton } from "./composer";

export const metadata = { title: "Messages · Post Social" };

type Contact = { id: string; username: string | null; name: string | null };
type Conversation = { id: string; status: "open" | "done" | "archived"; unread: number; last_message_at: string; last_preview: string | null; can_reply: boolean; reply_until: string | null; contact: Contact; account: { platform?: string; handle: string | null; display_name: string } };
type Message = { id: string; direction: "in" | "out"; text: string | null; attachments: Array<{ type: string; url: string | null }>; sent_by: string; created_at: string };
type Pending = { id: string; text: string; status: "queued" | "failed"; error: string | null };

const who = (c: Contact) => (c.username ? `@${c.username}` : c.name ?? "Unknown person");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const BY: Record<string, string> = { automation: "Automation", person: "You", agent: "AI agent", instagram: "From the app" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ workspace?: string; account?: string; c?: string; status?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/inbox/messages", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const status = params.status === "done" || params.status === "archived" ? params.status : "open";
  const { accounts, account } = await inboxAccounts(client, workspace.id, params.account);
  const list = await callServer<{ conversations: Conversation[] }>("conversations", { workspace_id: workspace.id, status, ...(account ? { account_id: account } : {}) });
  if (!list) notFound();
  const selectedId = params.c ?? list.conversations[0]?.id;
  const open = selectedId ? await callServer<{ conversation: Conversation; messages: Message[]; pending: Pending[] }>("conversation", { conversation_id: selectedId }) : null;
  const base = new URLSearchParams(inboxQuery(params.workspace, account));
  const link = (extra: Record<string, string>) => `/beta/inbox/messages?${new URLSearchParams({ ...Object.fromEntries(base), ...extra })}`;
  const unread = list.conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <AutoRefresh />
      <InboxNav active="messages" workspace={params.workspace} unread={unread} accounts={accounts} account={account} />
      <Card className="mt-5 grid min-h-[560px] overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col border-b border-ps-line md:border-b-0 md:border-r">
          <div className="flex gap-1 border-b border-ps-line p-2 text-xs">
            {(["open", "done", "archived"] as const).map((s) => (
              <Link key={s} href={link(s === "open" ? {} : { status: s })} className={cn("rounded-md px-2.5 py-1", s === status ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
                {s === "open" ? "Open" : s === "done" ? "Done" : "Archived"}
              </Link>
            ))}
          </div>
          {list.conversations.length === 0 ? (
            <p className="m-0 p-6 text-center text-ps-muted">{status === "open" ? "No open conversations. DMs to your Instagram accounts and Facebook Pages show up here." : status === "done" ? "Nothing marked done yet." : "Nothing archived. Archiving removes a conversation from here, not from Instagram or Messenger."}</p>
          ) : (
            <ul className="m-0 list-none overflow-y-auto p-0">
              {list.conversations.map((c) => (
                <li key={c.id}>
                  <Link href={link({ ...(status === "open" ? {} : { status }), c: c.id })} className={cn("flex flex-col gap-0.5 border-b border-ps-line px-3 py-2.5 hover:bg-ps-fg/[0.03]", c.id === selectedId && "bg-ps-fg/[0.05]")}>
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate", c.unread ? "font-medium text-ps-text" : "text-ps-text")}>{who(c.contact)}</span>
                      {c.unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-ps-plum" aria-label={`${c.unread} unread`} />}
                      <span className="ml-auto shrink-0 text-xs text-ps-subtle">{ago(c.last_message_at)}</span>
                    </span>
                    <span className="truncate text-xs text-ps-muted">{c.last_preview ?? " "}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open ? (
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-ps-line px-4 py-2.5">
              <div className="flex flex-col">
                <span className="font-medium">{who(open.conversation.contact)}</span>
                <span className="text-xs text-ps-subtle">to {accountLabel(open.conversation.account)}</span>
              </div>
              <span className="flex-1" />
              {workspace.role !== "reviewer" && <DoneButton conversationId={open.conversation.id} status={open.conversation.status} />}
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
              {open.messages.map((m) => (
                <div key={m.id} className={cn("flex max-w-[75%] flex-col gap-0.5", m.direction === "out" ? "self-end items-end" : "self-start items-start")}>
                  <div className={cn("rounded-2xl px-3 py-2 text-[13px] whitespace-pre-wrap", m.direction === "out" ? "rounded-br-md bg-ps-plum text-ps-ground" : "rounded-bl-md bg-ps-segment")}>
                    {m.text ?? (m.attachments.length ? "Attachment" : "")}
                    {m.attachments.filter((a) => a.url).map((a, i) => (
                      <a key={i} href={a.url!} target="_blank" rel="noopener noreferrer" className="block text-xs underline">Open {a.type}</a>
                    ))}
                  </div>
                  <span className="text-[11px] text-ps-subtle">{m.direction === "out" ? `${BY[m.sent_by] ?? "You"} · ` : ""}{ago(m.created_at)}</span>
                </div>
              ))}
              {open.pending.map((p) => (
                <div key={p.id} className="flex max-w-[75%] flex-col items-end gap-0.5 self-end">
                  <div className="rounded-2xl rounded-br-md bg-ps-plum/60 px-3 py-2 text-[13px] text-ps-ground whitespace-pre-wrap">{p.text}</div>
                  <span className={cn("text-[11px]", p.status === "failed" ? "text-ps-failed-text" : "text-ps-subtle")}>{p.status === "failed" ? `Didn't send: ${p.error}` : "Sending…"}</span>
                </div>
              ))}
            </div>
            <Composer conversationId={open.conversation.id} canReply={open.conversation.can_reply} replyUntil={open.conversation.reply_until} readOnly={workspace.role === "reviewer"} />
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 text-ps-muted">Pick a conversation.</div>
        )}
      </Card>
    </div>
  );
}
