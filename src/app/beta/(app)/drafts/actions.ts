"use server";

import { revalidatePath } from "next/cache";
import { callPosts } from "../create/actions";

// Delete a draft for good (the same posts function AIs use; it only deletes drafts and
// cancelled posts, and logs who did it).
export async function deleteDraft(postId: string) {
  const r = await callPosts("delete", { post_id: postId });
  if (r.ok) revalidatePath("/beta/drafts");
  return r;
}
