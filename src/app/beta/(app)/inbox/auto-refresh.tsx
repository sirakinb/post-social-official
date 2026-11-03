"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-reads the page every few seconds while it's visible, so new DMs, comments and sent
// replies show up without a reload.
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
