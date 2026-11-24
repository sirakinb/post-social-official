// Billing as the test customer sees it, on whichever plan it is on. The prod test customer
// is also a hands-on account (on the paid plan with a card since Nov 23, 2026), so each test
// reads the plan the page shows and checks that plan's view: Free offers a way to add a
// card, Paid shows the next charge, the card and the X limit. Never presses Add a card,
// Update, Save or Cancel paid plan (they open payment or change billing).
import { describe, expect, test } from "e2e";

// The "Your month" summary says "To pay" on Free and "Next charge" (or, while cancelling,
// "Paid plan ends") on the paid plan.
const PAID = /^(Next charge|Paid plan ends)$/;

describe("billing", () => {
  test("shows the current plan and how to pay for it", { session: "tester" }, async ({ app, screen }) => {
    await app.open("/beta/billing");
    await expect(screen.getByRole("heading", "Billing").first()).toBeVisible();
    const month = screen.getByRole("region", "Your month");
    await expect(month).toBeVisible();
    if ((await month.getByText(PAID).count()) > 0) {
      // Paid: a card is on file and can be updated; nothing asks for a card.
      await expect(screen.getByRole("region", "Card and receipts").getByRole("button", "Update")).toBeVisible();
      await expect(screen.getByRole("button", /^Add a card/)).toHaveCount(0);
    } else {
      // Free: within the free accounts a card costs $0 a month; past them, the estimate.
      await expect(month.getByText("To pay")).toBeVisible();
      const withinFree = (await month.getByText(/accounts are free/).count()) > 0;
      await expect(month.getByRole("button", withinFree ? "Add a card · $0/mo" : /^Add a card · \$[\d,]+\.\d{2}\/mo$/)).toBeVisible();
    }
  });

  test("explains what X posts cost on the current plan", { session: "tester" }, async ({ app, agent, screen }) => {
    await app.open("/beta/billing");
    const x = screen.getByRole("region", "X spending");
    await expect(x).toBeVisible();
    if ((await screen.getByRole("region", "Your month").getByText(PAID).count()) > 0) {
      // Paid: X is billed monthly up to a limit the customer sets.
      await expect(x.getByRole("spinbutton", "X monthly limit in dollars")).toBeVisible();
      await expect(x.getByRole("button", "Add a card")).toHaveCount(0);
      await agent.assert("the X spending section shows a monthly X limit the customer can change, and either gives the price per X post and says X posts are added to the monthly bill, or says X posting is off because the limit is $0");
    } else {
      await expect(x.getByRole("button", "Add a card")).toBeVisible();
      await agent.assert("the X spending section says posting to X needs a card, gives the price per X post, and says X posts are added to the monthly bill; it does not say X posts are paused or that a limit has been reached");
    }
  });
});
