import { Code, PageHeader } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: command line · Post Social",
  description: "Use Post Social from a terminal, script or agent without MCP. JSON in, JSON out.",
};

export default function CliPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / API and CLI reference" title="Command line">
        <p>For terminals, scripts and agents without MCP. JSON in, JSON out; add <code className="font-mono text-ink">--pretty</code> to read it yourself.</p>
      </PageHeader>
      <Code>{`npx postsocial login                     # sign in through your browser
npx postsocial list-social-accounts --pretty
npx postsocial upload --file ./launch.mp4   # prints the media id when it's ready
npx postsocial create-post --caption "We're live!" \\
  --media-ids <media id> \\
  --destinations '[{"account_id":"<id>","options":{"media_type":"reel"}}]' \\
  --scheduled-at 2026-10-06T15:00:00Z
npx postsocial create-post --help           # every option for a command`}</Code>
      <p className="mt-2 text-xs text-ink-subtle">On a server or in CI, use <code className="font-mono">--key ps_live_...</code> or set <code className="font-mono">POSTSOCIAL_API_KEY</code>. Test keys (<code className="font-mono">ps_test_...</code>) can do everything except publish.</p>
    </div>
  );
}
