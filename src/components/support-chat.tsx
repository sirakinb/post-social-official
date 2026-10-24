"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Crisp support chat, on the website, the docs and the signed-in app. It stays off the screen
// where you approve an AI app (/oauth), so nothing sits over that decision.
export const CRISP_WEBSITE_ID = "f6e9161e-ebd2-452c-98fd-2b9a059fd0e9";

type Crisp = { push: (command: unknown[]) => void };

export function chatHiddenOn(pathname: string) {
  return /^\/(oauth|tiktok-media)(\/|$)/.test(pathname);
}

export function SupportChat() {
  const hidden = chatHiddenOn(usePathname());

  // The chat stays loaded across page changes, so hide or show it as the page changes.
  useEffect(() => {
    const crisp = (window as unknown as { $crisp?: Crisp }).$crisp;
    crisp?.push(["do", hidden ? "chat:hide" : "chat:show"]);
  }, [hidden]);

  if (hidden) return null;
  return (
    <Script id="crisp-chat" strategy="afterInteractive">
      {`window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID="${CRISP_WEBSITE_ID}";(function(){if(document.getElementById("crisp-loader"))return;var s=document.createElement("script");s.id="crisp-loader";s.src="https://client.crisp.chat/l.js";s.async=1;document.getElementsByTagName("head")[0].appendChild(s);})();`}
    </Script>
  );
}
