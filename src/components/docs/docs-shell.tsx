"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { DOCS_NAV, docsNeighbours, searchDocs } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

// The frame around every docs page: a top bar with search and the start button, a sidebar of
// grouped sections, an "On this page" list on wide screens and previous/next links.

const TOP_BAR = "57px";

function Search({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const results = searchDocs(query);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className={cn("relative", className)}>
      <label className="sr-only" htmlFor="docs-search">Search the docs</label>
      <input
        id="docs-search"
        type="search"
        value={query}
        autoComplete="off"
        placeholder="Search the docs"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="h-9 w-full rounded-full border border-white/[0.12] bg-white/[0.05] px-4 text-sm text-ink placeholder:text-ink-subtle focus:border-[#ffc48a]/60 focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-80 overflow-y-auto rounded-xl border border-white/[0.12] bg-[#140f24] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
          {results.length ? (
            <ul aria-label="Search results">
              {results.map((page) => (
                <li key={page.href}>
                  <Link href={page.href} className="block rounded-lg px-3 py-2 hover:bg-white/[0.06]">
                    <span className="block text-sm font-medium text-ink">{page.title}{page.soon ? <span className="ml-2 text-xs font-normal text-[#ffc48a]">Coming soon</span> : null}</span>
                    <span className="block text-xs text-ink-subtle">{page.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-ink-subtle">No pages match &ldquo;{query.trim()}&rdquo;.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarNav() {
  const pathname = usePathname().replace(/\/$/, "") || "/docs";
  return (
    <nav aria-label="Docs sections" className="space-y-6">
      {DOCS_NAV.map((group) => (
        <div key={group.title}>
          <p className="utility-label px-3 text-ink-subtle">{group.title}</p>
          <ul className="mt-2 space-y-0.5">
            {group.pages.map((page) => {
              const active = page.href === pathname;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition", active ? "bg-white/[0.08] text-ink" : "text-ink-muted hover:bg-white/[0.04] hover:text-ink")}
                  >
                    <span>{page.title}</span>
                    {page.soon && <span className="text-[11px] text-[#ffc48a]/80">Soon</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

type Heading = { id: string; text: string };

// Lists the page's own section headings; read from the page so every docs page gets one.
function Toc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    // Read the headings once the page is in place; setting state here is not synchronous.
    const timer = setTimeout(() => {
      const found: Heading[] = [];
      for (const h of document.querySelectorAll<HTMLElement>("#docs-content h2")) {
        const id = h.id || h.closest<HTMLElement>("section[id]")?.id;
        if (id && h.textContent) {
          h.setAttribute("data-toc-id", id);
          found.push({ id, text: h.textContent });
        }
      }
      setHeadings(found);
      setActive(found[0]?.id ?? "");
      if (!found.length || typeof IntersectionObserver === "undefined") return;
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
          if (visible) setActive(visible.target.getAttribute("data-toc-id") ?? "");
        },
        { rootMargin: "-80px 0px -65% 0px" },
      );
      for (const h of document.querySelectorAll<HTMLElement>("#docs-content h2[data-toc-id]")) observer.observe(h);
    }, 0);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [pathname]);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page">
      <p className="utility-label text-ink-subtle">On this page</p>
      <ul className="mt-3 space-y-1.5 border-l border-white/[0.08]">
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className={cn("-ml-px block border-l py-0.5 pl-3 text-[13px] leading-snug transition", active === h.id ? "border-[#ffc48a] text-ink" : "border-transparent text-ink-subtle hover:text-ink")}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pager() {
  const { previous, next } = docsNeighbours(usePathname());
  if (!previous && !next) return null;
  return (
    <nav aria-label="Previous and next pages" className="mt-16 grid gap-3 border-t border-white/[0.07] pt-6 sm:grid-cols-2">
      {previous ? (
        <Link href={previous.href} className="rounded-xl border border-border bg-surface px-4 py-3 hover:border-[#ffc48a]/40">
          <span className="block text-xs text-ink-subtle">Previous</span>
          <span className="mt-0.5 block text-sm font-medium text-ink">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-[#ffc48a]/40 sm:text-right">
          <span className="block text-xs text-ink-subtle">Next</span>
          <span className="mt-0.5 block text-sm font-medium text-ink">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}

export function DocsShell({ cta, children }: { cta: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // The menu closes by itself when the page changes: it is open only on the page it was opened on.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menu = openedOn === pathname;
  const setMenu = (open: boolean | ((open: boolean) => boolean)) => setOpenedOn((now) => ((typeof open === "function" ? open(now === pathname) : open) ? pathname : null));

  return (
    <div className="min-h-screen overflow-x-clip bg-[#0B0816] text-ink">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_80%_at_50%_0%,rgba(155,108,255,0.16),transparent_70%)]" />
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0B0816]/85 backdrop-blur" style={{ height: TOP_BAR }}>
        <div className="mx-auto flex h-full max-w-[88rem] items-center gap-3 px-4 md:px-6">
          <button
            type="button"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="docs-sidebar"
            onClick={() => setMenu((open) => !open)}
            className="inline-flex size-9 flex-none items-center justify-center rounded-lg border border-white/[0.12] text-ink-muted hover:text-ink lg:hidden"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d={menu ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
          <Brand size="sm" />
          <span className="utility-label hidden text-ink-subtle sm:inline">Docs</span>
          <span className="flex-1" />
          <Search key={`top-${pathname}`} className="hidden w-full max-w-xs md:block" />
          {cta}
        </div>
      </header>

      {menu && <button type="button" aria-label="Close menu" onClick={() => setMenu(false)} className="fixed inset-0 z-40 bg-black/60 lg:hidden" />}

      <div className="relative mx-auto flex max-w-[88rem] gap-10 px-4 md:px-6">
        <aside
          id="docs-sidebar"
          style={{ top: TOP_BAR, height: `calc(100vh - ${TOP_BAR})` }}
          className={cn(
            "fixed bottom-0 left-0 z-50 w-72 flex-none overflow-y-auto border-r border-white/[0.07] bg-[#0B0816] px-4 py-6 transition-transform lg:sticky lg:z-0 lg:w-60 lg:translate-x-0 lg:border-r-0 lg:bg-transparent lg:px-0",
            menu ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Search key={`menu-${pathname}`} className="mb-6 md:hidden" />
          <SidebarNav />
        </aside>

        <main id="docs-content" className="min-w-0 max-w-3xl flex-1 pb-24 pt-10 lg:pt-12">
          {children}
          <Pager />
        </main>

        <aside style={{ top: TOP_BAR, height: `calc(100vh - ${TOP_BAR})` }} className="sticky hidden w-52 flex-none overflow-y-auto py-12 xl:block">
          <Toc />
        </aside>
      </div>

      <footer className="border-t border-white/[0.07]">
        <p className="mx-auto flex max-w-[88rem] flex-wrap gap-x-4 gap-y-1 px-4 py-6 text-xs text-ink-subtle md:px-6">
          <span>© 2026 Pentridge Media. All rights reserved.</span>
          <Link href="/" className="hover:text-ink">postsocial.xyz</Link>
          <Link href="/changelog" className="hover:text-ink">Changelog</Link>
        </p>
      </footer>
    </div>
  );
}
