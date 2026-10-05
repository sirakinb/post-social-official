import Link from "next/link";
import { ActivityFeed } from "@/components/beta/activity-feed";
import { LocalTime } from "@/components/beta/local-time";
import { ActorMark } from "@/components/beta/marks";
import { Card, CardHeader, PlatformMark, Status, Thumb } from "@/components/beta/ui";
import { loadHome } from "@/lib/beta/home";
import { loadViewer } from "@/lib/beta/workspace";

export const metadata = { title: "Home · Post Social" };

function greeting() {
  // The server's clock is UTC; a neutral greeting reads right in every time zone.
  return "Welcome back";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function HomePage() {
  const { viewer, workspace, client } = await loadViewer("/beta");
  if (!workspace) {
    return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  }
  const home = await loadHome(client, workspace);
  const firstName = viewer.name.split(" ")[0];

  const status = [
    home.goingOut ? `${plural(home.goingOut, "post")} going out in the next 24 hours` : home.upcoming.length ? "Nothing going out in the next 24 hours" : "Nothing scheduled yet",
  ];

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-8 py-4 [background-image:linear-gradient(rgba(155,108,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(155,108,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]">
        <div>
          <h1 className="m-0 text-lg font-medium tracking-[-0.01em]">{greeting()}, {firstName}</h1>
          <p className="mt-1 text-ps-muted">
            {status[0]}
            {home.attention.length > 0 && (
              <>
                <span className="text-ps-subtle"> · </span>
                <a href="#attention" className="text-ps-plum-soft hover:text-ps-text">{plural(home.attention.length, "thing")} {home.attention.length === 1 ? "needs" : "need"} your attention</a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {home.aiNames.length > 0 && (
            <span className="inline-flex h-[30px] items-center gap-2 rounded-full border border-white/[0.08] px-2.5 text-ps-muted">
              <span className="flex">
                {home.aiNames.slice(0, 3).map((name, i) => (
                  <ActorMark key={name} kind="oauth_grant" name={name} size={18} className={i ? "-ml-1.5" : undefined} />
                ))}
              </span>
              {home.aiNames.length === 1 ? `${home.aiNames[0]} connected` : `${home.aiNames.length} AI apps connected`}
            </span>
          )}
          <Link href="/beta/create" className="inline-flex h-8 items-center rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground hover:bg-[#AD86FF]">New post</Link>
        </div>
      </header>

      <div className="flex w-full max-w-[1100px] flex-col gap-6 px-8 pb-12 pt-7">
        {!home.setup.done && <Setup setup={home.setup} />}

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <Card aria-label="Up next">
            <CardHeader title="Up next" action={<Link href="/beta/calendar" className="text-xs text-ps-plum-soft hover:text-ps-text">Calendar</Link>} />
            {home.upcoming.length === 0 ? (
              <div className="px-4 py-8 text-center text-ps-muted">
                Nothing scheduled. Ask your AI:
                <code className="mt-3 block rounded-lg border border-ps-line bg-ps-ground px-3 py-2 font-mono text-xs text-ps-text">&quot;Schedule a post for each day this week&quot;</code>
              </div>
            ) : (
              home.upcoming.map((p) => (
                <Link key={p.id} href="/beta/calendar" className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 last:border-b-0 hover:bg-white/[0.02]">
                  <span className="w-[76px] flex-none font-mono text-xs text-ps-muted">
                    {p.scheduledAt ? <LocalTime iso={p.scheduledAt} /> : "Now"}
                  </span>
                  {p.thumb ? <Thumb url={p.thumb.url} isVideo={p.thumb.isVideo} /> : <Thumb url={null} isVideo={false} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.caption || "No caption"}</span>
                    <span className="mt-1 flex gap-1">
                      {p.destinations.map((d, i) => <PlatformMark key={i} platform={d.platform} size={18} />)}
                    </span>
                  </span>
                  <Status tone={p.status === "processing" ? "attention" : "scheduled"} label={p.status === "processing" ? "Publishing" : p.status === "awaiting_approval" ? "Waiting" : "Scheduled"} />
                </Link>
              ))
            )}
          </Card>

          <Card id="attention" aria-label="Needs attention">
            <CardHeader title="Needs attention" action={<span className="font-mono text-[11px] text-ps-subtle">{home.attention.length}</span>} />
            {home.attention.length === 0 ? (
              <p className="px-4 py-8 text-center text-ps-muted">All clear. Everything published as planned.</p>
            ) : (
              home.attention.map((a) => (
                <div key={a.id} className="flex gap-3 border-b border-white/[0.04] px-4 py-3.5 last:border-b-0">
                  <PlatformMark platform={a.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{a.title}</span>
                      {a.kind === "failed" ? <Status tone="failed" label="Failed" /> : <Status tone="attention" label="Reconnect" />}
                    </div>
                    <p className="mt-1.5 leading-relaxed text-ps-muted">{a.detail}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Link href={a.href} className="inline-flex h-7 items-center rounded-[7px] border border-ps-line-strong bg-ps-raised px-3 text-xs hover:border-ps-plum/50">
                        {a.kind === "account" ? "Reconnect" : "See what happened"}
                      </Link>
                      <LocalTime iso={a.when} className="text-xs text-ps-subtle" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        <Card id="activity" aria-label="Activity">
          <CardHeader title="Activity" action={<Link href="/beta/activity" className="text-xs text-ps-plum-soft hover:text-ps-text">View all</Link>} />
          <ActivityFeed rows={home.activity} actors={home.actors} />
        </Card>
      </div>
    </div>
  );
}

function Setup({ setup }: { setup: { connected: number; aiConnections: number; hasPosts: boolean } }) {
  const steps = [
    { done: setup.connected > 0, title: "Connect a social account", detail: "Sign in to Instagram, Facebook, Threads, YouTube or TikTok. Post Social never sees your passwords.", href: "/beta/accounts", cta: "Connect an account" },
    { done: setup.aiConnections > 0, title: "Connect your AI", detail: "Add Post Social to Claude, ChatGPT, Claude Code or Cursor. You approve it once.", href: "/beta/keys", cta: "Connect an AI" },
    { done: setup.hasPosts, title: "Ask your AI to post", detail: "Try: \"Post this photo to Instagram tomorrow at 9.\"", href: "/docs", cta: "See examples" },
  ];
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card aria-label="Get set up" className="overflow-hidden">
      <CardHeader title="Get set up" action={<span className="font-mono text-[11px] text-ps-subtle">{doneCount} of 3</span>} />
      <ol className="m-0 list-none p-0">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 border-b border-white/[0.04] px-4 py-3 last:border-b-0">
            <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] ${s.done ? "border-ps-live/50 bg-ps-live/[0.12] text-ps-live" : i === current ? "border-ps-plum text-ps-plum-soft" : "border-ps-line-strong text-ps-subtle"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={s.done ? "text-ps-subtle line-through decoration-ps-subtle/50" : ""}>{s.title}</div>
              {i === current && (
                <>
                  <p className="mt-1 text-ps-muted">{s.detail}</p>
                  <Link href={s.href} className="mt-2.5 inline-flex h-8 items-center rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground hover:bg-[#AD86FF]">{s.cta}</Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
