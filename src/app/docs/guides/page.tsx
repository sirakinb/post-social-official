import Link from "next/link";
import { ComingSoon, PageHeader } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: recipes · Post Social",
  description: "Ready-to-use prompts for common jobs.",
};

export default function GuidesPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Guides and recipes" title="Recipes" />
      <div className="mt-6">
        <ComingSoon>
          <p>This page will hold prompts you can paste into Claude or ChatGPT, such as scheduling a week of posts or sending one video to every platform. Each one will be tried against the real tools before it is listed.</p>
          <p>For now, <Link href="/docs/quickstart" className="text-accent hover:underline">the quickstart</Link> has a first prompt to try.</p>
        </ComingSoon>
      </div>
    </div>
  );
}
