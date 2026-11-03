"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { accountLabel } from "./account-label";
import type { AccountOption } from "./automations/types";

// Switches the inbox between all accounts (Instagram, Facebook Pages, Threads) and one; kept in the address as ?account=.
export function AccountPicker(props: { accounts: AccountOption[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const pick = (id: string) => {
    const next = new URLSearchParams(search);
    for (const key of ["account", "c"]) next.delete(key);
    if (id) next.set("account", id);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  return (
    <label className="flex h-[34px] items-center gap-2 rounded-lg border border-ps-line bg-ps-surface px-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ps-subtle">Account</span>
      <select value={props.value ?? ""} onChange={(e) => pick(e.target.value)} aria-label="Account" className="max-w-[200px] cursor-pointer truncate bg-transparent text-xs text-ps-text outline-none">
        <option value="">All accounts</option>
        {props.accounts.map((a) => (
          <option key={a.id} value={a.id}>{accountLabel(a)}</option>
        ))}
      </select>
    </label>
  );
}
