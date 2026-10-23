"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// DataFast visitor analytics. It runs on the public site (landing, pricing, docs, legal pages)
// and on sign-in and sign-up, but not inside the signed-in app or the screens where an AI app
// is approved: those pages show people's own data, and PostHog covers product use.
const PUBLIC_APP_PAGES = ["/beta/login", "/beta/signup"];

export function trackedPath(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (PUBLIC_APP_PAGES.includes(path)) return true;
  return !["/beta", "/oauth", "/tiktok-media"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function Analytics() {
  // Once the script is loaded it follows later page changes on its own, so DataFast's
  // Exclusions list (see docs/datafast-setup.md) is what keeps in-app pages out after sign-in.
  if (!trackedPath(usePathname())) return null;
  return <Script data-website-id="dfid_ev0xid7Q3dcHOMtmozFCa" data-domain="postsocial.xyz" src="https://datafa.st/js/script.js" strategy="afterInteractive" />;
}
