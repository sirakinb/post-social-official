import Link from "next/link";
import { Brand } from "@/components/brand";
import { CHANGELOG, type ChangelogKind } from "@/lib/changelog";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Changelog — Post Social",
  description: "What's new and improved in Post Social, with the date and time each change shipped.",
};

const TIME_ZONE = "America/New_York";

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "long", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" });

const kindStyles: Record<ChangelogKind, string> = {
  New: "bg-success-bg text-success",
  Improved: "bg-canvas text-ink-muted",
  Fixed: "bg-canvas text-ink-muted",
};

/** Groups entries by their day (US Eastern), keeping newest first. */
function byDay() {
  const days: { day: string; entries: typeof CHANGELOG }[] = [];
  for (const entry of CHANGELOG) {
    const day = dayFormat.format(new Date(entry.at));
    const last = days[days.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 md:px-8">
          <Brand size="sm" />
          <Link
            href="/"
            className="text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md px-2 py-1"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <article className="rounded-2xl border border-border bg-surface p-8 md:p-12">
          <h1 className="font-display text-3xl font-semibold text-ink">Changelog</h1>
          <p className="mt-2 text-sm text-ink-subtle">What&apos;s new and improved in Post Social. Times are US Eastern.</p>

          <div className="mt-10 space-y-10">
            {byDay().map(({ day, entries }) => (
              <section key={day} aria-labelledby={`day-${entries[0].at}`}>
                <h2 id={`day-${entries[0].at}`} className="font-display text-lg font-semibold text-ink">
                  {day}
                </h2>
                <ol className="mt-4 space-y-5 border-l border-border pl-5">
                  {entries.map((entry) => (
                    <li key={entry.at + entry.title}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", kindStyles[entry.kind])}>{entry.kind}</span>
                        <h3 className="text-sm font-medium text-ink">{entry.title}</h3>
                        <time dateTime={entry.at} className="text-xs text-ink-subtle">
                          {timeFormat.format(new Date(entry.at))}
                        </time>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{entry.body}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
