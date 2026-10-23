import Link from "next/link";
import { ComingSoon, PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: concepts · Post Social",
  description: "Workspaces, profiles, accounts, post states and API keys in plain language.",
};

// Each status is the one the API reports. Meanings come from the publishing code.
const STATES: { name: string; meaning: string }[] = [
  { name: "draft", meaning: "Saved, but nothing is sent. A post made without a time, or with draft turned on, stays a draft until it is published." },
  { name: "awaiting_approval", meaning: "Waiting for approval in Post Social before it goes out." },
  { name: "approved", meaning: "Cleared to go out. Posts in this state and in processing are being sent now." },
  { name: "scheduled", meaning: "Waiting for its time. You can move it or cancel it until it starts sending." },
  { name: "processing", meaning: "Being sent to the platforms now." },
  { name: "published", meaning: "Published on every account it went to." },
  { name: "partially_published", meaning: "Published on some of its accounts, and failed on others." },
  { name: "failed", meaning: "Published on none of its accounts. Each account's result says why." },
  { name: "cancelled", meaning: "Stopped before it started sending." },
];

export default function ConceptsPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Concepts" title="Concepts">
        <p>The few ideas that the rest of the docs rely on. Everything here is checked against how Post Social works today.</p>
      </PageHeader>

      <Section id="workspace" title="Workspace">
        <p>A workspace holds everything that belongs together: your connected accounts, posts, media, API keys and billing. When you sign up, Post Social creates your own workspace for you.</p>
        <p>People in a workspace have a role: owner, admin, member or reviewer. Only the owner and admins can change billing or manage API keys. An app approved by a reviewer can only read.</p>
      </Section>

      <Section id="profile" title="Profile">
        <p>A profile groups accounts under a business, organisation or client, so you can see and ask for one group at a time. Profiles are optional.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A profile has a name (up to 60 characters, unique in the workspace), and optionally a description (up to 280 characters), a colour and a time zone.</li>
          <li>A workspace can have up to 50 profiles.</li>
          <li>Deleting a profile does not disconnect its accounts. They stay connected and move to no profile.</li>
        </ul>
      </Section>

      <Section id="account" title="Account">
        <p>An account is one connected social account: an Instagram account, a Facebook Page, a YouTube channel, a TikTok account, a LinkedIn profile, a Bluesky account or an X account. Your first 2 accounts are free; see <Link href="/docs/billing" className="text-accent hover:underline">pricing and billing</Link>.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Only a person can connect an account, on the Accounts page. An AI can send you a link to do it, but never signs in for you.</li>
          <li>An account shows as Connected, or as Needs attention when you need to reconnect it.</li>
          <li>Disconnecting an account cancels the posts scheduled for it.</li>
          <li>One post can go to up to 20 accounts at once, with up to 35 media files and a shared caption of up to 10,000 characters. Each platform&apos;s own limits are still checked; see <Link href="/docs/platforms" className="text-accent hover:underline">Platforms</Link>.</li>
        </ul>
      </Section>

      <Section id="post-states" title="Draft, scheduled and published">
        <p>Every post has a status. The three you will see most are draft (saved, not sent), scheduled (waiting for its time) and published (live). A post made without a time is only a draft, so nothing goes out by accident. A time can be up to a year ahead.</p>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">What it means</th></tr></thead>
            <tbody className="divide-y divide-border">
              {STATES.map((state) => (
                <tr key={state.name} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-ink">{state.name}</td>
                  <td className="px-4 py-2">{state.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>A post is live only when its results show published with a live link. Posts that were already sent cannot be cancelled or deleted; they are kept for the record.</p>
      </Section>

      <Section id="keys" title="Test and live keys">
        <p>An API key lets your own code or an app use Post Social without signing in. Keys start with <code className="font-mono text-ink">ps_live_</code> or <code className="font-mono text-ink">ps_test_</code>.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A live key can do everything, including publishing and scheduling.</li>
          <li>A test key can do everything except publish or schedule. Posts made with a test key stay drafts.</li>
          <li>A key is shown once, when you create it. Only owners and admins can create or revoke keys, and a workspace can have up to 50 active keys.</li>
          <li>Claude, ChatGPT and most other apps sign in through Post Social and need no key.</li>
        </ul>
      </Section>

      <Section id="approvals" title="Approvals">
        <ComingSoon>
          <p>How approvals work, and how to require approval before an AI publishes, is not documented yet. We will add it once it has been checked end to end.</p>
        </ComingSoon>
      </Section>
    </div>
  );
}
