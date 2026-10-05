"use server";

import { revalidatePath } from "next/cache";
import { callPosts } from "../create/actions";

// Move or cancel a post from the calendar (the same posts function AIs use).
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
