// End-to-end journeys with e2e.com: an AI tester (Claude Code, on our Claude usage) goes
// through Post Social like a person and checks each screen makes sense, not just that it
// loads. Runs after every production release (.github/workflows/e2e-after-release.yml)
// against the live site, signed in as a dedicated Free test workspace, and by hand:
//   E2E_BASE_URL=http://localhost:3333 npx e2e run          (local site against dev)
// The tester's sign-in comes from E2E_USER_TESTER_USERNAME / E2E_USER_TESTER_PASSWORD; the
// model never sees the password. Journeys never pay, post or change billing on prod.
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { claudeCode } from "@e2e-dev/acp";

export default {
  tests: ["e2e/journeys/**/*.e2e.ts"],
  targets: [{ engine: web(), app: { url: process.env.E2E_BASE_URL ?? "https://www.postsocial.xyz" } }],
  agents: {
    default: {
      executor: claudeCode({ model: "sonnet" }),
      context:
        "You are a careful QA tester using Post Social, a social media management app, as a brand-new customer on the Free plan. " +
        "Judge each screen the way that customer would: it should load without errors, say clearly what it is for, and, when there's nothing on it yet, say what to do next. " +
        "Never press buttons that pay, subscribe, publish a post, delete anything or disconnect an account. " +
        "Ignore the small environment badge some test copies show at the bottom (for example 'development · InsForge ...'): the live site doesn't have it. " +
        "Pricing: the first 2 connected accounts are free; from the 3rd it's $5 a month each with a card. X posts cost 5 cents each (25 cents with a link), need a card, and are added to the monthly bill. " +
        "The sidebar has Accounts, Create, Drafts, Calendar, Analytics, Logs, Connect your AI, Usage, and Settings (General, Billing).",
    },
  },
  credentials: {
    tester: {
      username: process.env.E2E_USER_TESTER_USERNAME ?? "",
      password: () => process.env.E2E_USER_TESTER_PASSWORD ?? "",
    },
  },
  trace: "retain-on-failure",
} satisfies E2EConfig;
