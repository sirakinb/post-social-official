import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/beta/ui";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { InboxNav, inboxAccounts, inboxQuery } from "../inbox-nav";
import { ContactEditor } from "./contact-editor";

export const metadata = { title: "Contacts · Post Social" };

type Contact = {
  id: string;
  username: string | null;
  name: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  source: "comment" | "message";
  first_seen_at: string;
  last_seen_at: string;
  comments: number;
  conversation_id: string | null;
  got_automation_dm: boolean;
  account: { handle: string | null; display_name: string };
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; account?: string; q?: string; tag?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/inbox/contacts", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const { accounts, account } = await inboxAccounts(client, workspace.id, params.account);
  const data = await callServer<{ contacts: Contact[] }>("contacts", { workspace_id: workspace.id, ...(account ? { account_id: account } : {}), search: params.q ?? "", tag: params.tag ?? "", limit: 100 });
  if (!data) notFound();
  const ws = inboxQuery(params.workspace, account);
  const canEdit = workspace.role !== "reviewer";

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <InboxNav active="contacts" workspace={params.workspace} accounts={accounts} account={account} />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Contacts</h1>
          <p className="mt-1 text-ps-muted">Everyone who commented on or messaged your Instagram accounts.</p>
        </div>
        <form className="flex gap-2" action="/beta/inbox/contacts">
          {params.workspace && <input type="hidden" name="workspace" value={params.workspace} />}
          {account && <input type="hidden" name="account" value={account} />}
          {params.tag && <input type="hidden" name="tag" value={params.tag} />}
          <input name="q" defaultValue={params.q ?? ""} placeholder="Search handle, name or email" aria-label="Search contacts" className="h-9 w-64 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text placeholder:text-ps-subtle" />
        </form>
      </div>
      {params.tag && (
        <p className="mt-3 text-xs text-ps-muted">
          Tagged <span className="font-medium text-ps-text">{params.tag}</span> ·{" "}
          <Link href={`/beta/inbox/contacts?${new URLSearchParams({ ...ws, ...(params.q ? { q: params.q } : {}) })}`} className="text-ps-plum hover:underline">Show all</Link>
        </p>
      )}

      {data.contacts.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-ps-muted">{params.q || params.tag ? "No contacts match." : "No contacts yet. Anyone who comments on or messages your Instagram accounts appears here."}</Card>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ps-line text-xs text-ps-subtle">
                <th className="px-4 py-2.5 font-normal">Person</th>
                <th className="px-4 py-2.5 font-normal">Email</th>
                <th className="px-4 py-2.5 font-normal">Tags</th>
                <th className="px-4 py-2.5 font-normal">Activity</th>
                <th className="px-4 py-2.5 font-normal">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => (
                <tr key={c.id} className="border-b border-ps-line align-top last:border-0">
                  <td className="px-4 py-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{c.username ? `@${c.username}` : c.name ?? "Instagram user"}</span>
                      <span className="text-xs text-ps-subtle">{c.name && c.username ? `${c.name} · ` : ""}via {c.account.handle ? `@${c.account.handle}` : c.account.display_name}</span>
                      {c.notes && <span className="mt-1 text-xs text-ps-muted">{c.notes}</span>}
                    </span>
                    {canEdit && <ContactEditor id={c.id} email={c.email} tags={c.tags} notes={c.notes} />}
                  </td>
                  <td className="px-4 py-3 text-ps-muted">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Link key={t} href={`/beta/inbox/contacts?${new URLSearchParams({ ...ws, tag: t })}`} className="rounded-full bg-ps-segment px-2 py-0.5 text-xs text-ps-muted hover:text-ps-text">{t}</Link>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ps-muted">
                    {c.comments ? `${c.comments} comment${c.comments === 1 ? "" : "s"}` : ""}
                    {c.got_automation_dm ? `${c.comments ? " · " : ""}Got an automation DM` : ""}
                    {c.conversation_id && (
                      <>
                        {c.comments || c.got_automation_dm ? " · " : ""}
                        <Link href={`/beta/inbox/messages?${new URLSearchParams({ ...ws, c: c.conversation_id })}`} className="text-ps-plum hover:underline">Messages</Link>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ps-subtle">{day(c.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
