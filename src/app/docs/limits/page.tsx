import { ComingSoon, PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: rate limits and status · Post Social",
  description: "How many requests Post Social accepts, the daily and monthly plan limits, and what happens when you reach one.",
};

// From backend/lib/rate-limit.ts (request limits) and the plans table in migrations (plan limits).
const REQUEST_LIMITS = [
  { what: "Per network address", limit: "600 requests a minute, across the REST API and the MCP server" },
  { what: "Per API key or connected AI app", limit: "120 requests a minute" },
  { what: "Uploads from the Post Social web app", limit: "300 requests a minute, and 100 uploads or imports an hour, per person" },
];

const PLAN_LIMITS = [
  { what: "Connected accounts", free: "2", paid: "2,000" },
  { what: "API calls a day", free: "5,000", paid: "50,000" },
  { what: "Published posts a month", free: "3,000", paid: "3,000" },
  { what: "Media storage", free: "5 GB", paid: "100 GB" },
];

export default function LimitsPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / API and CLI reference" title="Rate limits and status">
        <p>The limits Post Social applies today. They are set to stay out of the way of real use and stop runaway scripts early.</p>
      </PageHeader>

      <Section id="requests" title="Request limits">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Applies to</th><th className="px-4 py-2 font-medium">Limit</th></tr></thead>
            <tbody className="divide-y divide-border">
              {REQUEST_LIMITS.map((row) => (
                <tr key={row.what} className="align-top"><td className="px-4 py-2 text-ink">{row.what}</td><td className="px-4 py-2">{row.limit}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Over a request limit, the API answers with status 429 and a <code className="font-mono text-ink">Retry-After</code> header saying how many seconds to wait. Wait that long and try again.</p>
      </Section>

      <Section id="plans" title="Plan limits">
        <p>These come from the plan your workspace is on. The Free plan is the one you start on; a workspace moves to Paid when you add a card.</p>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Limit</th><th className="px-4 py-2 font-medium">Free</th><th className="px-4 py-2 font-medium">Paid</th></tr></thead>
            <tbody className="divide-y divide-border">
              {PLAN_LIMITS.map((row) => (
                <tr key={row.what}><td className="px-4 py-2 text-ink">{row.what}</td><td className="px-4 py-2">{row.free}</td><td className="px-4 py-2">{row.paid}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>When the daily API limit is used up, calls answer 429 and work again after midnight UTC.</li>
          <li>When a post would go over the monthly limit, it is refused with a message saying so.</li>
          <li>You can see how close you are on the Usage page in Post Social, or by asking your AI for your usage.</li>
        </ul>
      </Section>

      <Section id="status" title="Status">
        <ComingSoon>
          <p>A service status page is not available yet. We will link it here when it is.</p>
        </ComingSoon>
      </Section>
    </div>
  );
}
