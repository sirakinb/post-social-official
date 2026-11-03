import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "messages", label: "Messages" },
  { id: "comments", label: "Comments" },
  { id: "automations", label: "Automations" },
  { id: "contacts", label: "Contacts" },
] as const;
export type InboxTab = (typeof TABS)[number]["id"];

// The Inbox's sections, on every inbox page.
export function InboxNav(props: { active: InboxTab; workspace?: string; unread?: number }) {
  const q = props.workspace ? `?workspace=${encodeURIComponent(props.workspace)}` : "";
  return (
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
  );
}
