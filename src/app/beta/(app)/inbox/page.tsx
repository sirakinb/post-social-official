import { redirect } from "next/navigation";

// Inbox opens on Automations (messages, comments and contacts come next).
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const params = await searchParams;
  redirect(`/beta/inbox/automations${params.workspace ? `?workspace=${encodeURIComponent(params.workspace)}` : ""}`);
}
