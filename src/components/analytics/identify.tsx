"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

// Links this browser's activity to the signed-in person (their id only, never their email)
// so replays and errors can be followed per account. Does nothing when PostHog is off.
export function IdentifyViewer({ userId, role }: { userId: string; role: string }) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId, { role });
  }, [userId, role]);
  return null;
}

// Forget the person on this browser (on sign-out).
export function forgetViewer() {
  if (posthog.__loaded) posthog.reset();
}

// A product event, e.g. the waitlist funnel. Does nothing when PostHog is off.
export function track(event: string, properties?: Record<string, unknown>) {
  if (posthog.__loaded) posthog.capture(event, properties);
}
