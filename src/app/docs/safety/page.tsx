import Link from "next/link";
import { PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: permissions and safety · Post Social",
  description: "What an AI can do on its own and how to disconnect it.",
};

export default function SafetyPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Connect your AI" title="Permissions and safety">
        <p>How you stay in charge of what your AI does.</p>
      </PageHeader>

      <Section id="what-an-ai-cannot-do" title="What an AI cannot do">
        <ul className="list-disc space-y-1 pl-5">
          <li>It cannot connect a social account. Only you can, by signing in on the platform&apos;s own page. An AI can send you the link.</li>
          <li>It does not publish a post unless it is told when: right now, or at a given time. Otherwise the post is saved as a draft.</li>
          <li>A test key cannot publish or schedule at all.</li>
        </ul>
      </Section>

      <Section id="disconnect" title="Disconnecting">
        <ul className="list-disc space-y-1 pl-5">
          <li><span className="text-ink">An AI app.</span> Open API/MCP in Post Social, find the app under AI apps you signed in to, and choose Disconnect. It can no longer use Post Social.</li>
          <li><span className="text-ink">An API key.</span> Revoke it under API keys on the same page.</li>
          <li><span className="text-ink">A social account.</span> On the Accounts page choose Disconnect, then Confirm disconnect. Posts scheduled for that account are cancelled.</li>
        </ul>
        <p>Everything an AI does is labelled with its name in your activity. See <Link href="/docs/concepts" className="text-accent hover:underline">Concepts</Link> for how keys and accounts fit together.</p>
      </Section>

      <Section id="approvals" title="Checking with you before it goes out">
        <p>You can have your AI check in with you before anything is published or scheduled. Ask it to save the post as a draft and show it to you first:</p>
        <blockquote className="rounded-lg border border-border bg-canvas-ivory px-4 py-3 text-sm leading-relaxed text-ink">Write the post as a draft and show it to me. Don&apos;t publish or schedule anything until I say so.</blockquote>
        <ul className="list-disc space-y-1 pl-5">
          <li>A draft is saved but nothing is sent. Your AI can show you the caption and the accounts, and you can ask for changes.</li>
          <li>When you say go, your AI publishes the draft, either right away or at a time you give.</li>
          <li>Approving is always a person&apos;s decision: an AI cannot approve a post on its own behalf.</li>
        </ul>
      </Section>
    </div>
  );
}
