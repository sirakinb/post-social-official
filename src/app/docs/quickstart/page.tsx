import Link from "next/link";
import { MCP_URL } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: quickstart · Post Social",
  description: "Connect your first social account, connect Claude or ChatGPT, send your first post by asking in plain language, and check that it went out.",
};

function Step({ id, number, title, children }: { id: string; number: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <p className="utility-label text-accent">Step {number}</p>
      <h2 className="mt-2 text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

function Example({ children }: { children: string }) {
  return <blockquote className="rounded-lg border border-border bg-canvas-ivory px-4 py-3 text-sm leading-relaxed text-ink">{children}</blockquote>;
}

// Marks where a real screenshot goes, so nothing is invented in its place.
function Screenshot({ children }: { children: string }) {
  return (
    <div role="img" aria-label={`Screenshot to add: ${children}`} className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-ink-subtle">
      <span className="utility-label">Screenshot to add</span>
      <span className="mt-1 block">{children}</span>
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <div>
        <p className="utility-label text-accent">Post Social / Docs / Quickstart</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink">Quickstart: your first post</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          You will connect one social account, connect Claude or ChatGPT, and ask your AI to post. It takes about ten minutes, and you don&apos;t need to write any code. Your first 2 accounts are free, with no card needed.
        </p>
        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          <li><a href="#account" className="text-accent hover:underline">Connect your first account</a></li>
          <li><a href="#ai" className="text-accent hover:underline">Connect Claude or ChatGPT</a></li>
          <li><a href="#post" className="text-accent hover:underline">Send your first post</a></li>
          <li><a href="#check" className="text-accent hover:underline">Check that it went out</a></li>
          <li><a href="#fails" className="text-accent hover:underline">If something fails</a></li>
        </ol>

        <Step id="account" number={1} title="Connect your first account">
          <p>You connect your social accounts yourself. An AI can send you a link to do it, but it never signs in for you.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Sign in to Post Social. If you don&apos;t have an account yet, create one from <Link href="/" className="text-accent hover:underline">postsocial.xyz</Link>.</li>
            <li>Open Accounts and find Connect an account.</li>
            <li>Choose a platform: Instagram, Facebook Pages, Threads, YouTube, TikTok, LinkedIn, Bluesky or X.</li>
            <li>Sign in on that platform&apos;s own page and approve access. Post Social never sees your password.</li>
          </ol>
          <Screenshot>Accounts page with the Connect an account row of platform buttons.</Screenshot>
          <p>A few things to know:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Instagram needs a Business or Creator account. Facebook connects Pages, so choose at least one Page when Facebook asks.</li>
            <li>Bluesky asks for your handle first, for example <code className="font-mono text-ink">name.bsky.social</code>.</li>
            <li>Your first 2 accounts are free. Connecting a 3rd needs a card; see <Link href="/docs/billing" className="text-accent hover:underline">pricing and billing</Link>.</li>
          </ul>
          <p>When it works, the account shows as Connected on the Accounts page.</p>
        </Step>

        <Step id="ai" number={2} title="Connect Claude or ChatGPT">
          <p>Both use the same address: <code className="font-mono text-ink">{MCP_URL}</code>. You sign in to Post Social and approve the app, so there is no key to copy.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-ink">Claude</h3>
              <p className="mt-2">Settings → Connectors → Add custom connector. Name it Post Social and paste the address above. Claude opens Post Social; sign in and press Allow.</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-base font-semibold text-ink">ChatGPT</h3>
              <p className="mt-2">Settings → Apps &amp; Connectors → Advanced settings → turn on Developer mode. Then Create a connector with the address above and sign in when asked.</p>
            </div>
          </div>
          <Screenshot>The Add custom connector dialog in Claude, with the Post Social address filled in.</Screenshot>
          <p>Using Claude Code, Cursor or another MCP app? See <Link href="/docs/connect" className="text-accent hover:underline">Connect an AI</Link>.</p>
          <p>To check it worked, ask your AI: <span className="text-ink">&ldquo;Which social accounts do I have connected in Post Social?&rdquo;</span> It should list the account from step 1.</p>
        </Step>

        <Step id="post" number={3} title="Send your first post">
          <p>Ask in plain language. For a first try, post text to an account that accepts text (Bluesky, X, Threads, LinkedIn or a Facebook Page):</p>
          <Example>Post &ldquo;Hello from my AI&rdquo; to my Bluesky account right now.</Example>
          <p>Your AI checks the post against that platform&apos;s rules, then sends it. To post later, give a date and time:</p>
          <Example>Schedule &ldquo;New video this Friday&rdquo; to my LinkedIn for tomorrow at 9am.</Example>
          <Screenshot>A Claude or ChatGPT chat where the AI confirms it has sent or scheduled the post.</Screenshot>
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="text-ink">Say when.</span> A post goes out only when you ask for it now or give a time. If you give neither, your AI saves a draft and nothing is posted; ask it to send the draft when you&apos;re ready. Posts can be scheduled up to a year ahead.</li>
            <li><span className="text-ink">Photos and videos.</span> Instagram, TikTok and YouTube posts need media. Give your AI a public https link to the file and it imports it into Post Social first.</li>
            <li><span className="text-ink">TikTok.</span> Direct posts need you to say who can see the post. Or set the account to Inbox first on the Accounts page and each post lands in your TikTok inbox for you to finish.</li>
            <li><span className="text-ink">X.</span> X posts are billed separately; see <Link href="/docs/billing#x" className="text-accent hover:underline">X posts in billing</Link>.</li>
          </ul>
        </Step>

        <Step id="check" number={4} title="Check that it went out">
          <p>A post is live only when its results show <span className="text-ink">published</span> with a live link. Asking your AI to say it sent the post is not enough. Ask:</p>
          <Example>Show me the publishing results for that post.</Example>
          <p>For each account you will see one of these:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="text-ink">Published</span>, with a live link. Open the link to see the post on the platform.</li>
            <li><span className="text-ink">Failed</span>, with the reason in plain language.</li>
            <li><span className="text-ink">Still in progress</span>. Platforms take a short while to process media; check again in a minute.</li>
          </ul>
          <Screenshot>Publishing results showing a published post with its live link.</Screenshot>
          <p>You can also see posts in Post Social itself: Drafts for saved drafts, Calendar for scheduled posts, and Logs for what your AI did.</p>
        </Step>

        <Step id="fails" number={5} title="If something fails">
          <p>Post Social explains each failure in plain words. Read the reason first, then try the matching fix:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li><span className="text-ink">The account shows Needs attention.</span> Access has expired or was removed. On the Accounts page choose Reconnect and sign in again.</li>
            <li><span className="text-ink">The post was saved as a draft.</span> Either no time was given, or the post has a problem such as a caption that is too long or media that doesn&apos;t fit the platform. Your AI gets the exact problems back; ask it to fix them and send the post again.</li>
            <li><span className="text-ink">&ldquo;Test keys cannot publish.&rdquo;</span> A test API key can do everything except publish. Create a live key under API/MCP instead.</li>
            <li><span className="text-ink">A TikTok account refuses a direct post.</span> The account is set to Inbox first. Ask for an inbox post, or change the setting on the Accounts page.</li>
            <li><span className="text-ink">X posts stopped.</span> You have reached your monthly X cap. See <Link href="/docs/billing#x" className="text-accent hover:underline">X posts in billing</Link>.</li>
            <li><span className="text-ink">Too many requests.</span> You have hit a rate limit. Wait a little while and try again.</li>
          </ul>
          <p>If the reason says it isn&apos;t something you can fix, it will point you to <a href="mailto:support@postsocial.xyz" className="text-accent hover:underline">support@postsocial.xyz</a>.</p>
        </Step>

        <section className="mt-12 rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-ink-muted">
          <h2 className="text-base font-semibold text-ink">Next steps</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><Link href="/docs/connect" className="text-accent hover:underline">Connect Claude Code, Cursor or another MCP app</Link></li>
            <li><Link href="/docs/tools" className="text-accent hover:underline">See everything your AI can do</Link></li>
            <li><Link href="/docs/billing" className="text-accent hover:underline">Pricing and billing</Link></li>
          </ul>
        </section>
        <p className="mt-8 text-xs text-ink-subtle"><Link href="/docs" className="hover:underline">Back to the docs</Link> · <Link href="/" className="hover:underline">postsocial.xyz</Link></p>
    </div>
  );
}
