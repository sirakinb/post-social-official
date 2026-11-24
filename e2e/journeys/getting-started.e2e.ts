// The first steps a new customer takes: every Get started step leads somewhere that lets
// them do it, and finding out how to add a card for X starts from the app itself. The prod
// test customer may be Free or Paid and may already have posts and connected accounts.
import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

describe("getting started", () => {
  // Like Send your first post below: once an AI is connected the step shows Done instead of
  // its Set up button, so this opens the setup page from the step or, without one, the sidebar.
  test("the Connect your AI step leads to setup steps", { session: "tester" }, async ({ app, agent, screen, browser }) => {
    await app.open("/beta/accounts");
    await expect(screen.getByRole("heading", "Accounts").first()).toBeVisible();
    const step = screen.getByRole("listitem").filter({ hasText: "Connect your AI" });
    const start = step.getByRole("link", "Set up");
    if ((await step.count()) > 0 && (await start.count()) > 0) {
      await start.click();
    } else {
      if ((await step.count()) > 0) await expect(step).toContainText("Done");
      await screen.getByRole("navigation", "Main").getByRole("link", "Connect your AI").click();
    }
    await expect(browser).toHaveURL(/\/beta\/api/);
    await agent.assert("the page shows step-by-step instructions for connecting an AI app such as Claude or ChatGPT");
  });

  // The step's button goes once the workspace has sent a post: the step shows Done instead, and
  // the whole list goes once all three steps are done. The prod test customer has posted (its
  // Bluesky pilot post, Nov 23, 2026), so this checks whichever state the list is in, then
  // opens the composer from the step's button or, without one, from the sidebar.
  test("the Send your first post step opens the composer", { session: "tester" }, async ({ app, screen, browser }) => {
    await app.open("/beta/accounts");
    await expect(screen.getByRole("heading", "Accounts").first()).toBeVisible();
    const step = screen.getByRole("listitem").filter({ hasText: "Send your first post" });
    const start = step.getByRole("link", "Create a post");
    if ((await step.count()) > 0 && (await start.count()) > 0) {
      await start.click();
    } else {
      if ((await step.count()) > 0) await expect(step).toContainText("Done");
      await screen.getByRole("link", "Create").first().click();
    }
    await expect(browser).toHaveURL(/\/beta\/create/);
  });

  test("a customer can find how to add a card for X", { session: "tester" }, async ({ app, agent, browser }) => {
    await app.open("/beta/accounts");
    await agent.act("find where to add a payment card so you can post to X");
    await expect(browser).toHaveURL(/\/beta\/billing/);
    // On the paid plan the card is already on file, with a button to update it.
    await agent.assert("there is a visible button to add a card, or a card is already on file with a visible button to update it");
  });
});
