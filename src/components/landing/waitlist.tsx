"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { joinWaitlist, type WaitlistResult } from "@/app/waitlist-action";

// The glowing "Join the waitlist" button and the glass panel it opens.
export function Waitlist() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="lp-lumen inline-flex items-center gap-2.5 rounded-full py-2.5 pl-2.5 pr-5 text-sm text-[#FFF8F0]">
        <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-white/90">
          <svg viewBox="0 0 16 16" className="size-3.5 text-[#2a1247]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </span>
        Join the waitlist
      </button>
      {open ? <WaitlistDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function WaitlistDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<WaitlistResult | null, FormData>(joinWaitlist, null);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    input.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  const done = state?.ok === true;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(8,5,16,0.62)] p-4 backdrop-blur-sm">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="waitlist-title" className="lp-glass lp-rise relative w-full max-w-[420px] rounded-[22px] p-6 text-[#FAF6F0] shadow-[0_40px_90px_rgba(0,0,0,.55)] sm:p-7">
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-[#FAF6F0]/70 transition hover:bg-white/10 hover:text-[#FAF6F0]">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
            <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {done ? (
          <div role="status" className="py-2">
            <h2 id="waitlist-title" className="lp-wordmark text-[13px]">You&apos;re on the list</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#FAF6F0]/75">We&apos;ll email you when your spot opens. Until then, keep your lanterns ready.</p>
          </div>
        ) : (
          <form action={action}>
            <h2 id="waitlist-title" className="lp-wordmark text-[13px]">Join the waitlist</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#FAF6F0]/75">Post to TikTok, Instagram, Facebook, Threads and YouTube from Claude, ChatGPT, or any AI you already use.</p>
            <label htmlFor="waitlist-email" className="sr-only">Email address</label>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <input
                ref={input}
                id="waitlist-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                maxLength={254}
                aria-invalid={state?.ok === false || undefined}
                aria-describedby={state?.ok === false ? "waitlist-error" : undefined}
                className="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-black/25 px-4 text-[15px] text-[#FAF6F0] outline-none placeholder:text-[#FAF6F0]/40 focus:border-[#CDB8FF]/70"
              />
              {/* Hidden from people; bots that fill it are quietly ignored. */}
              <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              <button type="submit" disabled={pending} className="lp-lumen h-11 rounded-full px-5 text-sm text-[#FFF8F0] disabled:opacity-70">
                {pending ? "Joining…" : "Join"}
              </button>
            </div>
            {state?.ok === false ? (
              <p id="waitlist-error" role="alert" className="mt-3 text-[13px] text-[#FFB4A8]">{state.error}</p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
