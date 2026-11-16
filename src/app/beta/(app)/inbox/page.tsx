import { redirect } from "next/navigation";

// Inbox opens on Messages.
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const params = await searchParams;
  redirect(`/beta/inbox/messages${params.workspace ? `?workspace=${encodeURIComponent(params.workspace)}` : ""}`);
}
