import Link from "next/link";
import { cn } from "@/lib/utils";
import { AccountPicker } from "./account-picker";
import type { AccountOption } from "./automations/types";

const TABS = [
  { id: "messages", label: "Messages" },
  { id: "comments", label: "Comments" },
  { id: "automations", label: "Automations" },
  { id: "contacts", label: "Contacts" },
] as const;
export type InboxTab = (typeof TABS)[number]["id"];

type Client = Awaited<ReturnType<typeof import("@/lib/beta/workspace").loadViewer>>["client"];

// The workspace's Instagram accounts, and the one picked in ?account= (null means all of them).
export async function inboxAccounts(client: Client, workspaceId: string, picked?: string) {
  const { data } = await client.database.from("connected_accounts").select("id, handle, display_name").eq("workspace_id", workspaceId).eq("platform", "instagram").neq("health", "disconnected").order("display_name");
  const accounts = (data ?? []) as AccountOption[];
  return { accounts, account: accounts.some((a) => a.id === picked) ? picked! : null };
}

// The query every inbox link keeps: the workspace and the picked account.
export const inboxQuery = (workspace?: string, account?: string | null): Record<string, string> => ({
  ...(workspace ? { workspace } : {}),
  ...(account ? { account } : {}),
});

// The Inbox's sections, on every inbox page, with the account picker when there's more than one account.
export function InboxNav(props: { active: InboxTab; workspace?: string; unread?: number; accounts?: AccountOption[]; account?: string | null }) {
  const query = new URLSearchParams(inboxQuery(props.workspace, props.account)).toString();
  const q = query ? `?${query}` : "";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Inbox" className="flex w-fit gap-1 rounded-lg border border-ps-line bg-ps-surface p-1 text-xs">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/beta/inbox/${t.id}${q}`}
            aria-current={t.id === props.active ? "page" : undefined}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1", t.id === props.active ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}
          >
            {t.label}
            {t.id === "messages" && props.unread ? <span className="rounded-full bg-ps-plum px-1.5 text-[10px] font-medium text-ps-ground">{props.unread}</span> : null}
          </Link>
        ))}
      </nav>
      {props.accounts && props.accounts.length > 1 && <AccountPicker accounts={props.accounts} value={props.account ?? null} />}
    </div>
  );
}
