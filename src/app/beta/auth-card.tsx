import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

// Frame shared by the new sign-in and reset pages; matches the existing /login page.
export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    // data-ph-mask: replays hide emails shown on the sign-in and reset steps.
    <div data-ph-mask className="technical-grid flex min-h-screen flex-col">
      <header className="border-b border-border bg-[#080610]/90"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8"><Brand /><Link href="/" className="rounded-md px-2 py-1 text-sm font-medium text-ink-muted hover:text-ink">Back to home</Link></div></header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="grooved-surface w-full max-w-md rounded-xl border border-border bg-surface p-7 shadow-hairline md:p-8">
          <div className="text-center"><p className="utility-label text-accent">Post Social / Beta</p><h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink">{title}</h1><p className="mt-2 text-sm text-ink-muted">{intro}</p></div>
          {children}
        </div>
      </main>
    </div>
  );
}
