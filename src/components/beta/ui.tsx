// Small building blocks of the redesigned app (Phase 6 design direction).
import { FacebookLogo, InstagramLogo, ThreadsLogo, TikTokLogo, YouTubeLogo } from "@/components/platform-logos";
import { cn } from "@/lib/utils";

export type Tone = "live" | "scheduled" | "failed" | "attention" | "quiet";

const TONE: Record<Tone, { dot: string; text: string }> = {
  live: { dot: "bg-ps-live", text: "text-ps-live" },
  scheduled: { dot: "bg-ps-plum", text: "text-ps-plum-soft" },
  failed: { dot: "bg-ps-failed", text: "text-[#FF8A8E]" },
  attention: { dot: "bg-ps-attention", text: "text-ps-attention" },
  quiet: { dot: "bg-ps-subtle", text: "text-ps-subtle" },
};

// A 6 px dot and a word. Only failures get a tinted pill, so they stand out.
export function Status({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  if (tone === "failed") {
    return <span className={cn("inline-flex items-center rounded-full bg-ps-failed/[0.14] px-2 py-px text-[11px] text-[#FF8A8E]", className)}>{label}</span>;
  }
  return (
    <span className={cn("inline-flex flex-none items-center gap-1.5 text-xs", TONE[tone].text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} />
      {label}
    </span>
  );
}

const LOGOS = { instagram: InstagramLogo, facebook: FacebookLogo, threads: ThreadsLogo, youtube: YouTubeLogo, tiktok: TikTokLogo } as const;
export const PLATFORM_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube", tiktok: "TikTok" };

// The platform's real logo in a small rounded square.
export function PlatformMark({ platform, size = 20, className }: { platform: string; size?: number; className?: string }) {
  const Logo = LOGOS[platform as keyof typeof LOGOS];
  return (
    <span
      className={cn("inline-flex flex-none items-center justify-center rounded-md border border-ps-line-strong bg-ps-raised text-ps-text", className)}
      style={{ width: size, height: size }}
      title={PLATFORM_NAMES[platform] ?? platform}
    >
      {Logo ? <Logo className="h-[58%] w-[58%]" aria-label={PLATFORM_NAMES[platform]} /> : null}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" }) {
  return (
    <section className={cn("rounded-xl border border-ps-line bg-ps-surface", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
      <h2 className="m-0 text-[13px] font-medium text-ps-text">{title}</h2>
      {action}
    </div>
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-mono text-[10.5px] uppercase tracking-[0.14em] text-ps-subtle", className)}>{children}</div>;
}

// A post's media in a small square: the image itself, or a frame placeholder for video.
export function Thumb({ url, isVideo, size = 36 }: { url: string | null; isVideo: boolean; size?: number }) {
  const style = { width: size, height: size };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed links to private storage
    return <img src={url} alt="" className="flex-none rounded-lg border border-ps-line object-cover" style={style} />;
  }
  return (
    <span className="flex flex-none items-center justify-center rounded-lg border border-ps-line bg-gradient-to-br from-[#2A2142] to-ps-raised text-ps-muted" style={style}>
      {isVideo ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
      )}
    </span>
  );
}
