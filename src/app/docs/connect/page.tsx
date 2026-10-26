import Link from "next/link";
import { Card, Code, PageHeader, Section } from "@/components/docs/parts";
import { MCP_URL } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: connect your AI · Post Social",
  description: "Connect Claude, ChatGPT, Claude Code, Codex, Cursor, Grok, Muse, Hermes, OpenClaw or your own code to Post Social to publish and schedule social posts.",
};

// The steps follow the setup tabs on API/MCP in the app (src/app/beta/(app)/api/api-view.tsx).
export default function ConnectPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Connect your AI" title="Connect an AI">
        <p>Everything uses one address: <code className="font-mono text-ink">{MCP_URL}</code>. Most apps send you to Post Social to sign in and approve them, so there is no key to copy. The same steps are on the API/MCP page in Post Social.</p>
      </PageHeader>

      <div className="mt-8 grid grid-cols-1 gap-4">
        <Card id="claude" title="Claude (claude.ai and the desktop app)">
          <p>Settings → Connectors → Add custom connector. Name it Post Social and paste the address above. Claude opens Post Social; sign in and press Allow.</p>
          <p>A connector added in Claude also works in Claude Code when Claude Code is signed in with the same Claude plan.</p>
        </Card>
        <Card id="chatgpt" title="ChatGPT">
          <p>Settings → Apps &amp; Connectors → Advanced settings → turn on Developer mode. Then Create a connector with the address above and sign in when asked.</p>
          <p>ChatGPT connectors don&apos;t carry over to Codex, so set Codex up separately.</p>
        </Card>
        <Card id="claude-code" title="Claude Code">
          <p>Only needed if Claude Code isn&apos;t signed in with your Claude plan (for example, with an API key). Add the server, then run <code className="font-mono text-ink">/mcp</code> in Claude Code and choose Authenticate:</p>
          <Code>{`claude mcp add --transport http post-social ${MCP_URL}`}</Code>
          <p>Prefer a key (for scripts and CI)? Create one under API keys on the API/MCP page in Post Social and add it as a header:</p>
          <Code>{`claude mcp add --transport http post-social ${MCP_URL} --header "Authorization: Bearer ps_live_..."`}</Code>
        </Card>
        <Card id="codex" title="Codex">
          <p>For the Codex CLI, the IDE extension and the ChatGPT desktop app. Run both lines; the second opens your browser to approve:</p>
          <Code>{`codex mcp add post-social --url ${MCP_URL}\ncodex mcp login post-social`}</Code>
        </Card>
        <Card id="cursor" title="Cursor">
          <p>Add this to <code className="font-mono text-ink">~/.cursor/mcp.json</code> (or <code className="font-mono text-ink">.cursor/mcp.json</code> in a project), then press Connect next to Post Social in Cursor&apos;s MCP settings:</p>
          <Code>{JSON.stringify({ mcpServers: { "post-social": { url: MCP_URL } } }, null, 2)}</Code>
        </Card>
        <Card id="grok" title="Grok">
          <p>On grok.com, open grok.com/connectors → New Connector → Custom, paste the address above, then sign in. For the Grok CLI, run this and press <code className="font-mono text-ink">i</code> in <code className="font-mono text-ink">/mcps</code> to sign in:</p>
          <Code>{`grok mcp add --transport http post-social ${MCP_URL}`}</Code>
        </Card>
        <Card id="muse" title="Meta Muse">
          <p>Muse connects with an API key. On the API/MCP page in Post Social, open the Muse tab and choose Create a key for Muse. Then send Muse this message and paste the key into Muse&apos;s secure form when it asks (never into the chat):</p>
          <Code>{`Connect a custom MCP server called Post Social at ${MCP_URL}. It's a remote MCP server (streamable HTTP, JSON-RPC over POST) that takes a bearer token in the Authorization header. Don't open the address in a browser: it only answers MCP requests. Use "Muse" as the clientInfo name when you initialize. Ask me for the token in your secure credential form, then list the tools to check it works and save it as a skill.`}</Code>
        </Card>
        <Card id="hermes" title="Hermes">
          <p>Add this to <code className="font-mono text-ink">~/.hermes/config.yaml</code>, then run <code className="font-mono text-ink">/reload-mcp</code>. Hermes prints a link to approve Post Social the first time:</p>
          <Code>{`mcp_servers:\n  post-social:\n    url: "${MCP_URL}"\n    auth: oauth`}</Code>
        </Card>
        <Card id="openclaw" title="OpenClaw">
          <p>Run both lines; the second opens your browser to approve:</p>
          <Code>{`openclaw mcp add post-social --url ${MCP_URL} --transport streamable-http --auth oauth\nopenclaw mcp login post-social`}</Code>
        </Card>
        <Card id="other" title="Other MCP apps">
          <p>Add a remote MCP server with the address above. Most apps sign in automatically; for apps that only take keys, send <code className="font-mono text-ink">Authorization: Bearer ps_live_...</code>.</p>
          <Code>{JSON.stringify({ mcpServers: { "post-social": { url: MCP_URL } } }, null, 2)}</Code>
        </Card>
        <Card id="cli" title="Scripts and the terminal">
          <p>No AI app needed: the <Link href="/docs/cli" className="text-accent hover:underline">command line</Link> takes JSON in and gives JSON out, and the <Link href="/docs/api" className="text-accent hover:underline">REST API</Link> uses an API key.</p>
        </Card>
      </div>

      <Section id="good-to-know" title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>You connect your social accounts in Post Social yourself; AIs can send you a connect link but never sign in for you.</li>
          <li>TikTok posts from an AI go out directly, with the audience you ask for. To finish them in TikTok first, set the account to “Inbox first” in Accounts (or ask your AI to), and each post lands in your TikTok inbox.</li>
          <li>Everything an AI does is labelled with its name in your activity, and you can disconnect it any time under AI apps you signed in to, on the API/MCP page.</li>
          <li>Your first 2 accounts are free. After that it&apos;s usage based: you pay per connected account, and X posts cost a few cents each. See <Link href="/docs/billing" className="text-accent hover:underline">pricing and billing</Link>.</li>
        </ul>
      </Section>
    </div>
  );
}
