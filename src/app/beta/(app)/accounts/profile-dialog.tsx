"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProfileInput } from "./actions";

export type Profile = { id: string; name: string; description: string | null; color: string; timezone: string | null };

// Same swatches as the server's PROFILE_COLORS.
export const PROFILE_COLORS = ["#9B6CFF", "#3DD68C", "#F5B54A", "#F2555A", "#4AA8F5", "#F57AC4", "#2DD4BF", "#A3A3A3"];

const field = "h-9 w-full rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px] text-ps-text placeholder:text-ps-subtle";

function timeZones(current: string) {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {}
  return zones.includes(current) ? zones : [current, ...zones];
}

// Create or edit a profile. Deleting is offered when editing; the profile's accounts stay
// connected and move to no profile.
export function ProfileDialog(props: {
  profile: Profile | null;
  accountCount: number;
  onSave: (input: ProfileInput) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onClose: () => void;
}) {
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [name, setName] = useState(props.profile?.name ?? "");
  const [description, setDescription] = useState(props.profile?.description ?? "");
  const [color, setColor] = useState(props.profile?.color ?? PROFILE_COLORS[0]);
  const [timezone, setTimezone] = useState(props.profile?.timezone ?? browserZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const zones = useMemo(() => timeZones(timezone), [timezone]);
  const first = useRef<HTMLInputElement>(null);
  const close = useRef(props.onClose);
  useEffect(() => {
    close.current = props.onClose;
  });

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function act(run: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const failed = await run();
    setBusy(false);
    if (failed) setError(failed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-h"
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-ps-fg/10 bg-ps-dialog shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => props.onSave({ name, description, color, timezone }));
        }}
      >
        <div className="border-b border-ps-fg/[0.06] px-5 py-4">
          <h2 id="profile-dialog-h" className="m-0 text-[15px] font-medium">{props.profile ? "Edit profile" : "New profile"}</h2>
          <p className="m-0 mt-1 text-xs text-ps-subtle">A profile groups the accounts of one business, organisation or client.</p>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ps-muted">Name</span>
            <input ref={first} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vibe Code Philly" className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ps-muted">Description <span className="text-ps-subtle">(optional)</span></span>
            <textarea maxLength={280} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Meetups for builders in Philadelphia" className={cn(field, "h-auto resize-none py-2")} />
          </label>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-xs text-ps-muted">Colour</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn("h-7 w-7 rounded-full border-2", color === c ? "border-ps-text" : "border-transparent hover:border-ps-fg/30")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ps-muted">Time zone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={cn(field, "")}>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="m-0 text-xs text-ps-failed-text">{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-ps-fg/[0.06] px-5 py-3">
          {props.onDelete &&
            (confirmDelete ? (
              <button type="button" disabled={busy} onClick={() => act(props.onDelete!)} className="h-8 rounded-lg border border-ps-failed/40 px-3 text-xs text-ps-failed-text">
                {props.accountCount ? `Delete, keep its ${props.accountCount} account${props.accountCount === 1 ? "" : "s"}` : "Confirm delete"}
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="h-8 rounded-lg px-2 text-xs text-ps-failed-text hover:underline">Delete profile</button>
            ))}
          <span className="flex-1" />
          <button type="button" onClick={props.onClose} className="h-8 rounded-lg px-3 text-xs text-ps-subtle hover:text-ps-text">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-lg bg-ps-plum px-3.5 text-[13px] font-medium text-ps-ground hover:bg-ps-plum-hover disabled:opacity-60">
            {busy ? "Saving…" : props.profile ? "Save" : "Create profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
