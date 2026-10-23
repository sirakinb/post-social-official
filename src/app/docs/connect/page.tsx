import Link from "next/link";
import { Card, Code, PageHeader, Section } from "@/components/docs/parts";
import { MCP_URL } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: connect your AI · Post Social",
  description: "Connect Claude, ChatGPT, Claude Code, Cursor or your own code to Post Social to publish and schedule social posts.",
};

export default function ConnectPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Connect your AI" title="Connect an AI">
        <p>Everything uses one address: <code className="font-mono text-ink">{MCP_URL}</code>. You sign in to Post Social and approve the app; no key to copy.</p>
      </PageHeader>

      <div className="mt-8 grid grid-cols-1 gap-4">
        <Card id="claude" title="Claude (claude.ai and the desktop app)">
          <p>Settings → Connectors → Add custom connector. Name it Post Social and paste the address above. Claude opens Post Social; sign in and press Allow.</p>
        </Card>
        <Card id="chatgpt" title="ChatGPT">
          <p>Settings → Apps &amp; Connectors → Advanced settings → turn on Developer mode. Then Create a connector with the address above and sign in when asked.</p>
        </Card>
        <Card id="claude-code" title="Claude Code">
          <p>Add the server, then run <code className="font-mono text-ink">/mcp</code> in Claude Code and choose Authenticate:</p>
          <Code>{`claude mcp add --transport http post-social ${MCP_URL}`}</Code>
          <p>Prefer a key (for scripts and CI)? Create one under API keys in Post Social and add it as a header:</p>
          <Code>{`claude mcp add --transport http post-social ${MCP_URL} --header "Authorization: Bearer ps_live_..."`}</Code>
        </Card>
        <Card id="cursor" title="Cursor and other MCP apps">
          <p>Add a remote MCP server with the address above. Most apps sign in automatically; for apps that only take keys, send <code className="font-mono text-ink">Authorization: Bearer ps_live_...</code>.</p>
          <Code>{JSON.stringify({ mcpServers: { "post-social": { url: MCP_URL } } }, null, 2)}</Code>
        </Card>
      </div>

      <Section id="good-to-know" title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>You connect your social accounts in Post Social yourself; AIs can send you a connect link but never sign in for you.</li>
          <li>TikTok posts from an AI go out directly, with the audience you ask for. To finish them in TikTok first, set the account to “Inbox first” in Accounts (or ask your AI to), and each post lands in your TikTok inbox.</li>
          <li>Everything an AI does is labelled with its name in your activity, and you can disconnect it any time under API keys.</li>
          <li>Your first 2 accounts are free. After that it&apos;s usage based: you pay per connected account, and X posts cost a few cents each. See <Link href="/docs/billing" className="text-accent hover:underline">pricing and billing</Link>.</li>
        </ul>
      </Section>
    </div>
  );
}
