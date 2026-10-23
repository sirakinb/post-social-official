import Link from "next/link";
import { ComingSoon, PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: troubleshooting · Post Social",
  description: "Fix failed posts and accounts that need attention.",
};

export default function TroubleshootingPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Troubleshooting" title="Troubleshooting">
        <p>Post Social explains each failure in plain words. Start with the reason it gives, then use the fixes below.</p>
      </PageHeader>

      <Section id="start-here" title="Start here">
        <p>
          The quickstart lists the most common problems and their fixes, including accounts that need attention, posts saved as drafts, test keys, TikTok inbox accounts and the X cap. See{" "}
          <Link href="/docs/quickstart#fails" className="text-accent hover:underline">If something fails</Link>.
        </p>
        <p>To see what happened to a post, ask your AI for its publishing results. A post is live only when the results show published with a live link. See <Link href="/docs/concepts#post-states" className="text-accent hover:underline">post statuses</Link>.</p>
        <p>If a failure says it isn&apos;t something you can fix, it points you to <a href="mailto:support@postsocial.xyz" className="text-accent hover:underline">support@postsocial.xyz</a>.</p>
      </Section>

      <Section id="error-reference" title="Error reference">
        <ComingSoon>
          <p>A full list of failure reasons and error codes, each with a plain explanation and a fix, is not written yet. We will build it from the messages Post Social actually returns.</p>
        </ComingSoon>
      </Section>
    </div>
  );
}
