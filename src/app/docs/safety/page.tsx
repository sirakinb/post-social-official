import Link from "next/link";
import { ComingSoon, PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: permissions and safety · Post Social",
  description: "What an AI can do on its own and how to disconnect it.",
};

export default function SafetyPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Connect your AI" title="Permissions and safety">
        <p>How you stay in charge of what your AI does. This page is partly written; the parts that are not confirmed yet are marked.</p>
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

      <Section id="approvals" title="Approvals">
        <ComingSoon>
          <p>How to require your approval before an AI publishes is not documented yet. We will add it once it has been checked end to end.</p>
        </ComingSoon>
      </Section>
    </div>
  );
}
