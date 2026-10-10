import Link from "next/link";
import { Brand } from "@/components/brand";
import { API_URL, documentedOperations, MCP_URL, SITE } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: connect your AI · Post Social",
  description: "Connect Claude, ChatGPT, Claude Code, Cursor or your own code to Post Social to publish and schedule social posts.",
};

function Code({ children }: { children: string }) {
  return <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-canvas-ivory px-4 py-3 font-mono text-xs leading-relaxed text-ink">{children}</pre>;
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  const ops = documentedOperations();
  return (
    <div className="technical-grid min-h-screen">
      <header className="border-b border-border bg-[#080610]/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 md:px-8">
          <Brand size="sm" />
          <nav className="flex gap-4 text-sm">
            <a href="#connect" className="text-ink-muted hover:text-ink">Connect</a>
            <a href="#cli" className="text-ink-muted hover:text-ink">CLI</a>
            <a href="#api" className="text-ink-muted hover:text-ink">API</a>
            <a href="#tools" className="text-ink-muted hover:text-ink">Tools</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 md:px-8">
        <p className="utility-label text-accent">Post Social / Docs</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink">Connect your AI to your social accounts</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Connect your Instagram, Facebook Pages, Threads, YouTube and TikTok accounts in Post Social once. Then tell your AI what to post and when, and it publishes or schedules it. Your AI does the
          work; you stay in charge of what it does.
        </p>

        <h2 id="connect" className="mt-12 text-xl font-semibold text-ink">Connect an AI</h2>
        <p className="mt-1 text-sm text-ink-muted">Everything uses one address: <code className="font-mono text-ink">{MCP_URL}</code>. You sign in to Post Social and approve the app; no key to copy.</p>
        <div className="mt-4 grid gap-4">
          <Step title="Claude (claude.ai and the desktop app)">
            <p>Settings → Connectors → Add custom connector. Name it Post Social and paste the address above. Claude opens Post Social; sign in and press Allow.</p>
          </Step>
          <Step title="ChatGPT">
            <p>Settings → Apps &amp; Connectors → Advanced settings → turn on Developer mode. Then Create a connector with the address above and sign in when asked.</p>
          </Step>
          <Step title="Claude Code">
            <p>Add the server, then run <code className="font-mono text-ink">/mcp</code> in Claude Code and choose Authenticate:</p>
            <Code>{`claude mcp add --transport http post-social ${MCP_URL}`}</Code>
            <p>Prefer a key (for scripts and CI)? Create one under API keys in Post Social and add it as a header:</p>
            <Code>{`claude mcp add --transport http post-social ${MCP_URL} --header "Authorization: Bearer ps_live_..."`}</Code>
          </Step>
          <Step title="Cursor and other MCP apps">
            <p>Add a remote MCP server with the address above. Most apps sign in automatically; for apps that only take keys, send <code className="font-mono text-ink">Authorization: Bearer ps_live_...</code>.</p>
            <Code>{JSON.stringify({ mcpServers: { "post-social": { url: MCP_URL } } }, null, 2)}</Code>
          </Step>
        </div>

        <h2 id="cli" className="mt-12 text-xl font-semibold text-ink">Command line</h2>
        <p className="mt-1 text-sm text-ink-muted">For terminals, scripts and agents without MCP. JSON in, JSON out; add <code className="font-mono text-ink">--pretty</code> to read it yourself.</p>
        <Code>{`npx postsocial login                     # sign in through your browser
npx postsocial list-social-accounts --pretty
npx postsocial upload --file ./launch.mp4   # prints the media id when it's ready
npx postsocial create-post --caption "We're live!" \\
  --media-ids <media id> \\
  --destinations '[{"account_id":"<id>","options":{"media_type":"reel"}}]' \\
  --scheduled-at 2026-10-06T15:00:00Z
npx postsocial create-post --help           # every option for a command`}</Code>
        <p className="mt-2 text-xs text-ink-subtle">On a server or in CI, use <code className="font-mono">--key ps_live_...</code> or set <code className="font-mono">POSTSOCIAL_API_KEY</code>. Test keys (<code className="font-mono">ps_test_...</code>) can do everything except publish.</p>

        <h2 id="api" className="mt-12 text-xl font-semibold text-ink">REST API</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-muted">
          <p>Base address <code className="font-mono text-ink">{API_URL}</code>. Send <code className="font-mono text-ink">Authorization: Bearer ps_live_...</code> (or a signed-in app&apos;s token).</p>
          <p>The full description is at <a className="text-accent hover:underline" href={`${API_URL}/openapi.json`}>{`${API_URL}/openapi.json`}</a> (OpenAPI 3.1). For AIs, a summary is at <a className="text-accent hover:underline" href={`${SITE}/llms.txt`}>/llms.txt</a>.</p>
          <p>Errors always look like <code className="font-mono text-ink">{`{"error":{"code","message"}}`}</code> with a plain-language message. Writes accept an <code className="font-mono text-ink">Idempotency-Key</code> header, so retrying never posts twice.</p>
        </div>
        <Code>{`curl ${API_URL}/posts -H "Authorization: Bearer $POSTSOCIAL_API_KEY" -H "Content-Type: application/json" \\
  -d '{"caption":"Hello","destinations":[{"account_id":"<id>","options":{"media_type":"text"}}]}'`}</Code>

        <h2 id="tools" className="mt-12 text-xl font-semibold text-ink">Tools</h2>
        <p className="mt-1 text-sm text-ink-muted">The same {ops.length} actions everywhere: MCP tool name, REST endpoint and CLI command.</p>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {ops.map((op) => (
            <details key={op.name} className="group px-5 py-3">
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-ink">{op.name}</span>
                <span className="text-xs text-ink-subtle">{op.title}{op.destructive ? " · removes or cancels" : ""}</span>
              </summary>
              <p className="mt-2 text-sm text-ink-muted">{op.description}</p>
              <p className="mt-2 font-mono text-xs text-ink-subtle">{op.method} {op.path} · {op.cli}</p>
              {op.options.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                  {op.options.map((o) => (
                    <li key={o.name}><span className="font-mono text-ink">{o.name}</span> <span className="text-ink-subtle">{o.type}{o.required ? ", required" : ""}</span>{o.description ? `: ${o.description}` : ""}</li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-ink-muted">
          <h2 className="text-base font-semibold text-ink">Good to know</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You connect your social accounts in Post Social yourself; AIs can send you a connect link but never sign in for you.</li>
            <li>TikTok asks the creator to confirm each post, so posts from an AI land in your TikTok inbox: open TikTok and tap Post.</li>
            <li>Video covers: your AI can set a cover image (an image in your media library) or pick a frame of the video, with <code>cover_media_id</code> or <code>cover_time_ms</code> in a destination&apos;s options. Instagram Reels and YouTube take either; TikTok direct posts take a frame; TikTok drafts, Facebook and Threads use their own default. Instagram crops the cover to a square in your profile grid, so keep titles centred.</li>
            <li>Everything an AI does is labelled with its name in your activity, and you can disconnect it any time under API keys.</li>
          </ul>
        </section>
        <p className="mt-8 text-xs text-ink-subtle"><Link href="/" className="hover:underline">postsocial.xyz</Link></p>
      </main>
    </div>
  );
}
