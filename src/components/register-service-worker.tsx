"use client";

import { useEffect } from "react";

// Installs public/sw.js, which lets an installed Post Social receive shared photos and
// videos (Android). It never caches, so it can't serve stale pages.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
