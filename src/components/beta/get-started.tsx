import Link from "next/link";
import { cn } from "@/lib/utils";
import { type GetStarted as Steps, stepsDone } from "@/lib/beta/get-started";

// The three steps from sign-up to a first post, at the top of Accounts. Each ticks itself off
// from what the workspace has; the next one to do gets the main button.
const STEPS: Array<{ key: keyof Steps; title: string; text: string; action: string; href: string }> = [
  { key: "account", title: "Connect a social account", text: "Instagram, TikTok, YouTube and more. You sign in on each platform's own page.", action: "Connect", href: "#connect" },
  { key: "ai", title: "Connect your AI", text: "Claude, ChatGPT or any AI agent, so you can post just by asking.", action: "Set up", href: "/beta/api" },
  { key: "post", title: "Send your first post", text: "Ask your AI, or write one here. Post it now or schedule it.", action: "Create a post", href: "/beta/create" },
];

const check = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;

export function GetStartedPanel({ steps, hide }: { steps: Steps; hide: () => Promise<void> }) {
  const done = stepsDone(steps);
  const next = STEPS.find((s) => !steps[s.key])?.key;
  return (
    <section id="get-started" aria-labelledby="get-started-h" className="scroll-mt-6 rounded-xl border border-ps-line bg-ps-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ps-fg/[0.05] px-4 py-3">
        <h2 id="get-started-h" className="m-0 text-sm font-medium">Get started</h2>
        <span className="font-mono text-[11px] text-ps-subtle">{done} of 3 done</span>
        <span className="flex-1" />
        <a href="/docs/quickstart" target="_blank" rel="noopener" className="text-xs text-ps-muted hover:text-ps-text">Watch the 1-minute walkthrough<span className="sr-only"> (opens in a new tab)</span></a>
        <form action={hide}>
          <button type="submit" data-attr="hide-get-started" className="h-[26px] rounded-md px-2 text-xs text-ps-subtle hover:bg-ps-fg/[0.04] hover:text-ps-text">Hide</button>
        </form>
      </div>
      <div className="h-0.5 bg-ps-fg/[0.05]" aria-hidden="true">
        <div className="h-full bg-ps-plum transition-[width]" style={{ width: `${(done / 3) * 100}%` }} />
      </div>
      <ol className="m-0 list-none p-0">
        {STEPS.map((s, i) => {
          const ok = steps[s.key];
          return (
            <li key={s.key} className="flex items-center gap-3 border-b border-ps-fg/[0.04] px-4 py-3 last:border-b-0">
              <span className={cn("flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[11px]", ok ? "bg-ps-live/[0.15] text-ps-live-text" : "border border-ps-fg/[0.14] text-ps-muted")}>
                {ok ? check : i + 1}
                <span className="sr-only">{ok ? " (done)" : ""}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("font-medium", ok ? "text-ps-muted" : "text-ps-text")}>{s.title}</span>
                <span className="text-xs text-ps-subtle">{s.text}</span>
              </span>
              {ok ? (
                <span className="text-xs text-ps-live-text">Done</span>
              ) : (
                <Link
                  href={s.href}
                  data-attr={`get-started-${s.key}`}
                  className={cn("inline-flex h-[30px] flex-none items-center rounded-lg px-3 text-xs", s.key === next ? "bg-ps-plum font-medium text-ps-ground hover:bg-ps-plum-hover" : "border border-ps-fg/[0.12] hover:border-ps-fg/25")}
                >
                  {s.action}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
