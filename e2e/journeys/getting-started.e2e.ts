// The first steps a new customer takes: every Get started step leads somewhere that lets
// them do it, and finding out how to add a card for X starts from the app itself.
import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

describe("getting started", () => {
  test("the Connect your AI step leads to setup steps", { session: "tester" }, async ({ app, agent, browser }) => {
    await app.open("/beta/accounts");
    await agent.act("open the Connect your AI step from the Get started list");
    await expect(browser).toHaveURL(/\/beta\/api/);
    await agent.assert("the page shows step-by-step instructions for connecting an AI app such as Claude or ChatGPT");
  });

  test("the Send your first post step opens the composer", { session: "tester" }, async ({ app, agent, browser }) => {
    await app.open("/beta/accounts");
    await agent.act("start creating your first post from the Get started list");
    await expect(browser).toHaveURL(/\/beta\/create/);
  });

  test("a customer can find how to add a card for X", { session: "tester" }, async ({ app, agent, browser }) => {
    await app.open("/beta/accounts");
    await agent.act("find where to add a payment card so you can post to X");
    await expect(browser).toHaveURL(/\/beta\/billing/);
    await agent.assert("there is a visible button to add a card");
  });
});
