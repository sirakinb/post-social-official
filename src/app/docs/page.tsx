import Link from "next/link";
import { PageHeader } from "@/components/docs/parts";
import { LegacyAnchors } from "./legacy-anchors";

export const metadata = {
  title: "Docs · Post Social",
  description: "Connect Claude, ChatGPT, Claude Code, Cursor or your own code to Post Social to publish and schedule social posts.",
};

const CARDS = [
  { href: "/docs/quickstart", title: "Quickstart", text: "Connect an account and an AI, send your first post and check that it went out." },
  { href: "/docs/concepts", title: "Concepts", text: "Workspaces, profiles, accounts, post states and API keys in plain language." },
  { href: "/docs/connect", title: "Connect your AI", text: "Set up Claude, ChatGPT, Claude Code, Cursor or another MCP app." },
  { href: "/docs/platforms", title: "Platforms", text: "What each of the eight platforms can post, and the limits Post Social checks." },
  { href: "/docs/troubleshooting", title: "Troubleshooting", text: "Fix failed posts and accounts that need attention." },
  { href: "/docs/cli", title: "API and CLI reference", text: "The command line, the REST API and every tool your AI can use." },
  { href: "/docs/billing", title: "Billing", text: "Your first 2 accounts are free. See how pricing and X posts work." },
  { href: "/docs/guides", title: "Recipes", text: "Ready-to-use prompts for common jobs. Coming soon." },
];

export default function DocsPage() {
  return (
    <div>
      <LegacyAnchors />
      <PageHeader label="Post Social / Docs" title="Post Social docs">
        <p>
          Connect your Instagram, Facebook Pages, Threads, YouTube, TikTok, LinkedIn, Bluesky and X accounts in Post Social once. Then tell your AI what to post and when, and it publishes or schedules it. Your AI does the
          work; you stay in charge of what it does.
        </p>
      </PageHeader>
      <p className="mt-4 text-sm text-ink-muted">New to Post Social? <Link href="/docs/quickstart" className="text-accent hover:underline">Start with the quickstart</Link>.</p>

      <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <li key={card.href}>
            <Link href={card.href} className="lp-card block h-full p-5 transition hover:border-[#ffc48a]/40 hover:bg-white/[0.06]">
              <span className="block text-base font-semibold text-ink">{card.title}</span>
              <span className="mt-1.5 block text-sm leading-relaxed text-ink-muted">{card.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
