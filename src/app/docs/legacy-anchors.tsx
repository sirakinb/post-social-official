"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// /docs used to be one long page with these anchors. Old links like /docs#cli land on the
// section's own page (a fragment never reaches the server, so this has to run in the browser).
const MOVED: Record<string, string> = {
  connect: "/docs/connect",
  cli: "/docs/cli",
  api: "/docs/api",
  tools: "/docs/tools",
};

export function LegacyAnchors() {
  const router = useRouter();
  useEffect(() => {
    const target = MOVED[window.location.hash.slice(1)];
    if (target) router.replace(target);
  }, [router]);
  return null;
}
