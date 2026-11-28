"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// How long without a click, a key or a scroll before the page counts as left alone, how
// often it re-reads while left alone, and when it stops until someone comes back.
export const IDLE_AFTER_MS = 5 * 60_000;
export const IDLE_EVERY_MS = 60_000;
export const PAUSE_AFTER_MS = 30 * 60_000;

// Whether to re-read the page now. Each re-read costs several calls to the backend, and a
// tab left open overnight used to make them every few seconds until morning.
export function refreshDue({ now, lastActivity, lastRefresh, everyMs, visible }: { now: number; lastActivity: number; lastRefresh: number; everyMs: number; visible: boolean }) {
  if (!visible) return false;
  const idleFor = now - lastActivity;
  if (idleFor >= PAUSE_AFTER_MS) return false;
  return now - lastRefresh >= (idleFor >= IDLE_AFTER_MS ? Math.max(everyMs, IDLE_EVERY_MS) : everyMs);
}

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

// Re-reads the page every few seconds while it's visible and someone is using it, so new
// DMs, comments and sent replies show up without a reload. Left alone for 5 minutes it
// slows to once a minute; after 30 it stops. The first sign of the person coming back
// re-reads at once and picks the pace up again.
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const everyMs = seconds * 1000;
    let lastActivity = Date.now();
    let lastRefresh = Date.now();
    const refresh = () => {
      lastRefresh = Date.now();
      router.refresh();
    };
    const active = () => {
      const now = Date.now();
      const wasAway = now - lastActivity >= IDLE_AFTER_MS;
      lastActivity = now;
      if (wasAway && document.visibilityState === "visible") refresh();
    };
    // Coming back to the tab counts as activity; leaving it doesn't.
    const shown = () => {
      if (document.visibilityState === "visible") active();
    };
    const timer = setInterval(() => {
      if (refreshDue({ now: Date.now(), lastActivity, lastRefresh, everyMs, visible: document.visibilityState === "visible" })) refresh();
    }, everyMs);
    for (const event of ACTIVITY) window.addEventListener(event, active, { passive: true });
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, active);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [router, seconds]);
  return null;
}
