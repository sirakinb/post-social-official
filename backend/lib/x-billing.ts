// Whether a workspace can post to X. X posts are billed per post with no free allowance, so
// Free and Paid workspaces need a working card (the paid plan, which is $0 a month until the
// 3rd account). Comped plans (Tester) aren't billed and can always post. Used before a post is
// accepted (so nobody finds out only after it fails) and to word the worker's refusal.
import type { Sql } from "./access";
import { X_PRICES, xPriceText } from "./pricing";

// Subscription statuses that keep the paid plan (past_due while Stripe retries the card).
export const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function xNeedsCard(sql: Sql, workspaceId: string): Promise<boolean> {
  if (X_PRICES.freeMonthly > 0) return false;
  const [row] = await sql<{ plan: string; status: string | null }>(
    `SELECT coalesce((SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1), 'tester') AS plan,
            (SELECT subscription_status FROM public.workspace_billing WHERE workspace_id = $1) AS status`,
    [workspaceId],
  );
  if (!row || (row.plan !== "free" && row.plan !== "paid")) return false;
  return !(row.plan === "paid" && PAID_STATUSES.has(row.status ?? ""));
}

export const X_NEEDS_CARD_MESSAGE = `Posting to X needs a card. Add one on the Billing page; X posts are ${xPriceText()}, added to your monthly bill.`;
