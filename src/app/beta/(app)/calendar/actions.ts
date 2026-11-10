"use server";

import { revalidatePath } from "next/cache";
import { callPosts } from "../create/actions";

// Move, cancel or retry a post from the calendar or the logs (the same posts function AIs use).
export async function reschedule(postId: string, scheduledAt: string) {
  const r = await callPosts("reschedule", { post_id: postId, scheduled_at: scheduledAt });
  if (r.ok) revalidatePath("/beta/calendar");
  return r;
}

export async function cancel(postId: string) {
  const r = await callPosts("cancel", { post_id: postId });
  if (r.ok) revalidatePath("/beta/calendar");
  return r;
}

// A failed account of a post: send it again, or record that it's live anyway.
export async function retry(postId: string, accountId: string, startOver = false) {
  const r = await callPosts("retry", { post_id: postId, account_id: accountId, start_over: startOver });
  if (r.ok) {
    revalidatePath("/beta/calendar");
    revalidatePath("/beta/activity");
  }
  return r;
}

export async function markPublished(postId: string, accountId: string) {
  const r = await callPosts("mark_published", { post_id: postId, account_id: accountId });
  if (r.ok) {
    revalidatePath("/beta/calendar");
    revalidatePath("/beta/activity");
  }
  return r;
}
