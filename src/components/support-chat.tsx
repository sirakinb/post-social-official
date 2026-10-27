"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { chatHiddenOn, chatHiddenOnPhone } from "@/lib/support-chat";

// Crisp support chat, on the website, the docs and the signed-in app. Its snippet is in the
// page's <head> (src/lib/support-chat.ts). It stays off the screen where you approve an AI app
// (/oauth), so nothing sits over that decision, and off the composer on phones, where the
// bubble would cover the Post button.
type Crisp = { push: (command: unknown[]) => void };

// The chat stays loaded across page changes, so hide or show it as the page changes.
export function SupportChatVisibility() {
  const pathname = usePathname();
  const phone = usePhone();
  const hidden = chatHiddenOn(pathname) || (phone && chatHiddenOnPhone(pathname));
  useEffect(() => {
    const crisp = (window as unknown as { $crisp?: Crisp }).$crisp;
    crisp?.push(["do", hidden ? "chat:hide" : "chat:show"]);
  }, [hidden]);
  return null;
}

// Phone width, the same breakpoint as the app's layout (md, 768px).
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 767px)");
    if (!query) return;
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
