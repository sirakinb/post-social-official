"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { chatHiddenOn } from "@/lib/support-chat";

// Crisp support chat, on the website, the docs and the signed-in app. Its snippet is in the
// page's <head> (src/lib/support-chat.ts). It stays off the screen where you approve an AI app
// (/oauth), so nothing sits over that decision.
type Crisp = { push: (command: unknown[]) => void };

// The chat stays loaded across page changes, so hide or show it as the page changes.
export function SupportChatVisibility() {
  const hidden = chatHiddenOn(usePathname());
  useEffect(() => {
    const crisp = (window as unknown as { $crisp?: Crisp }).$crisp;
    crisp?.push(["do", hidden ? "chat:hide" : "chat:show"]);
  }, [hidden]);
  return null;
}
