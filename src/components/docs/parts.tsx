import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small building blocks shared by the docs pages.

export function PageHeader({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <header>
      <p className="utility-label text-[#ffc48a]">{label}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">{children}</div>}
    </header>
  );
}

export function Code({ children }: { children: string }) {
  return <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-canvas-ivory px-4 py-3 font-mono text-xs leading-relaxed text-ink">{children}</pre>;
}

export function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("scroll-mt-24", className)}>
      <h2 id={id} className="mt-12 scroll-mt-24 text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

export function Card({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

// A clearly marked gap: nothing is written here until it has been checked against the code.
export function ComingSoon({ title = "Coming soon", children }: { title?: string; children: ReactNode }) {
  return (
    <div role="note" className="rounded-xl border border-dashed border-[#ffc48a]/40 bg-[#ffc48a]/[0.04] p-5">
      <p className="utility-label text-[#ffc48a]">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}
