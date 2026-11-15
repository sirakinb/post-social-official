// Billing as a Free customer with no card: every place that asks for a card offers a way
// to add one, and X's cost is explained. Never presses Add a card (that opens payment).
import { describe, expect, test } from "e2e";

describe("billing on the Free plan", () => {
  test("offers a card at $0 a month", { session: "tester" }, async ({ app, screen }) => {
    await app.open("/beta/billing");
    await expect(screen.getByRole("button", "Add a card · $0/mo")).toBeVisible();
  });

  test("explains that X posts need a card and are billed monthly", { session: "tester" }, async ({ app, agent, screen }) => {
    await app.open("/beta/billing");
    const x = screen.getByRole("region", "X spending");
    await expect(x.getByRole("button", "Add a card")).toBeVisible();
    await agent.assert("the X spending section says posting to X needs a card, gives the price per X post, and says X posts are added to the monthly bill; it does not say X posts are paused or that a limit has been reached");
  });
});
