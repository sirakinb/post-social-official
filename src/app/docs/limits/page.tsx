import { ComingSoon, PageHeader } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: rate limits and status · Post Social",
  description: "Request limits and service status.",
};

export default function LimitsPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / API and CLI reference" title="Rate limits and status" />
      <div className="mt-6">
        <ComingSoon>
          <p>Request limits, plan limits and a link to service status are not published yet. We will add them once the numbers are confirmed as final.</p>
          <p>If you hit a limit today, the API answers with a plain message asking you to try again in a little while.</p>
        </ComingSoon>
      </div>
    </div>
  );
}
