"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { trackedPath } from "@/components/analytics";

// Rewardful (affiliate tracking). It remembers which affiliate's link a visitor came through, in
// a cookie, and gives the referral to the Add card form on /beta/billing so Stripe credits the
// payment to the affiliate. The key is Rewardful's public one.
const BILLING_PAGE = "/beta/billing";

// The public site and sign-in/sign-up (the same pages DataFast follows), plus the billing page,
// where the referral is read. The rest of the signed-in app and the AI approval screens stay out.
export function rewardfulPath(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  return path === BILLING_PAGE || trackedPath(path);
}

// Rewardful's own loader stub: it queues calls made before rw.js has loaded.
const QUEUE = "(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');";

type RewardfulWindow = Window & { Rewardful?: { Forms?: { attach: () => void } } };

export function Rewardful() {
  const pathname = usePathname();
  const active = rewardfulPath(pathname);
  // rw.js adds its hidden field to the forms on the page when it loads. The billing page can
  // also be reached from inside the app without a reload, so attach again once it is shown.
  useEffect(() => {
    if (active && pathname.replace(/\/$/, "") === BILLING_PAGE) (window as RewardfulWindow).Rewardful?.Forms?.attach();
  }, [active, pathname]);
  if (!active) return null;
  return (
    <>
      <Script id="rewardful-queue" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: QUEUE }} />
      <Script data-rewardful="a0dcca" src="https://r.wdfl.co/rw.js" strategy="afterInteractive" />
    </>
  );
}
