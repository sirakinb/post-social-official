// Every page in the sidebar, the way the test customer (Free or Paid) sees it: it opens, says
// what it's for, and when there's nothing on it yet, says what to do next.
import { describe, expect, test } from "e2e";

// heading: the page's main heading, or null when it changes (the Calendar shows the month).
const PAGES: Array<{ path: string; name: string; heading: string | null; makesSense: string }> = [
  { path: "/beta/accounts", name: "Accounts", heading: "Accounts", makesSense: "the page explains how to connect a social account and shows buttons for the platforms" },
  { path: "/beta/create", name: "Create", heading: "New post", makesSense: "the page lets you write a post and choose where it goes, or tells you to connect an account first" },
  { path: "/beta/drafts", name: "Drafts", heading: "Drafts", makesSense: "the page lists drafts, or says there are none and how to make one" },
  { path: "/beta/calendar", name: "Calendar", heading: null, makesSense: "the page shows a calendar of posts, or makes clear nothing is scheduled and how to schedule something" },
  { path: "/beta/analytics", name: "Analytics", heading: "Analytics", makesSense: "the page shows post stats, or says there are none yet and what to do to get some" },
  { path: "/beta/activity", name: "Logs", heading: "Logs", makesSense: "the page lists what happened in the workspace, or says what will show up here" },
  { path: "/beta/api", name: "Connect your AI", heading: "Connect your AI", makesSense: "the page explains how to connect an AI app such as Claude or ChatGPT, with setup steps" },
  { path: "/beta/usage", name: "Usage", heading: "Usage", makesSense: "the page shows the plan's limits and this period's usage in plain words" },
  { path: "/beta/settings", name: "Settings", heading: "Settings", makesSense: "the page shows the account, the workspace and links to billing and usage" },
  { path: "/beta/billing", name: "Billing", heading: "Billing", makesSense: "the page explains what the customer pays and how to add a card, or, on the paid plan, shows the next charge and the card on file" },
];

describe("every page", () => {
  for (const page of PAGES) {
    test(`${page.name} opens and makes sense`, { session: "tester" }, async ({ app, agent, screen }) => {
      await app.open(page.path);
      if (page.heading) await expect(screen.getByRole("heading", page.heading).first()).toBeVisible();
      // The Calendar's heading is the month; its New post button shows once it has loaded.
      else await expect(screen.getByRole("link", "New post").first()).toBeVisible();
      await agent.assert(`${page.makesSense}; there is no error message, broken layout or text that only makes sense to the people who built the app`);
    });
  }
});
