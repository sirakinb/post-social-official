"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// The support chat, in the signed-in app: Crisp knows who is writing (name and email), and a
// new customer who seems stuck gets one offer of help. It opens with one line when a
// connection attempt comes back with an error, or after a while on Accounts with nothing
// connected. Once per person on this browser; never again after that.
type Crisp = { push: (command: unknown[]) => void };

export const NUDGE_TEXT = "Stuck connecting your first account? Reply here and I'll help.";
export const NUDGE_AFTER_MS = 90_000;
export const nudgeKey = (userId: string) => `ps-chat-nudge-${userId}`;

export function ChatNudge({ userId, name, email, noAccounts }: { userId: string; name: string; email: string; noAccounts: boolean }) {
  const path = usePathname() ?? "";
  const failed = useSearchParams()?.has("error") ?? false;

  useEffect(() => {
    const w = window as unknown as { $crisp?: Crisp };
    w.$crisp = w.$crisp ?? ([] as unknown as Crisp);
    if (email) w.$crisp.push(["set", "user:email", [email]]);
    if (name) w.$crisp.push(["set", "user:nickname", [name]]);
  }, [email, name]);

  useEffect(() => {
    if (!noAccounts || !path.startsWith("/beta/accounts")) return;
    const key = nudgeKey(userId);
    let seen = false;
    try { seen = localStorage.getItem(key) !== null; } catch { /* storage off: show it once per page */ }
    if (seen) return;
    const offer = () => {
      try { localStorage.setItem(key, new Date().toISOString()); } catch { /* fine */ }
      (window as unknown as { $crisp?: Crisp }).$crisp?.push(["do", "message:show", ["text", NUDGE_TEXT]]);
    };
    if (failed) { offer(); return; }
    const timer = setTimeout(offer, NUDGE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [userId, noAccounts, path, failed]);

  return null;
}
