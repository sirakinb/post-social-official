"use client";

import { ConnectedAccount } from "@/lib/types";
import { platformLabel } from "@/lib/demo";
import { AccountAvatar } from "../account-avatar";
import { Checkbox } from "../ui/checkbox";
import { cn } from "@/lib/utils";

interface DestinationRailProps {
  accounts: ConnectedAccount[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

export function DestinationRail({
  accounts,
  selected,
  onChange,
  className,
}: DestinationRailProps) {
  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-semibold text-ink">Destinations</h3>
      <ul className="space-y-2">
        {accounts.map((account) => {
          const isSelected = selected.includes(account.id);
          const disabled = account.health !== "connected";
          return (
            <li key={account.id}>
              <label
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-accent",
                  isSelected
                    ? "border-accent bg-accent-muted"
                    : "border-border bg-surface hover:bg-canvas-ivory",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggle(account.id)}
                  aria-label={`Publish to ${account.displayName} on ${platformLabel(account.platform)}`}
                />
                <AccountAvatar
                  platform={account.platform}
                  src={account.avatarUrl}
                  name={account.displayName}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {account.displayName}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {platformLabel(account.platform)} · @{account.handle}
                  </p>
                </div>
                {account.health === "needs_attention" && (
                  <span className="text-right text-xs text-warning">Reconnect in Accounts</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
