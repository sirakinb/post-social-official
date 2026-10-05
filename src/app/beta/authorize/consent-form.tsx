"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { decide, type AuthorizeParams } from "./actions";

export function ConsentForm(props: { params: AuthorizeParams; clientName: string; workspaces: Array<{ id: string; name: string; role: string }> }) {
  const [workspaceId, setWorkspaceId] = useState(props.workspaces[0]?.id ?? "");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = props.workspaces.find((w) => w.id === workspaceId);

  async function answer(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const result = await decide(props.params, workspaceId, approve);
    if (!result.ok) {
      setBusy(null);
      return setError(result.error);
    }
    // Back to the app (which may use its own link scheme, e.g. cursor://).
    window.location.assign(result.data.redirect);
  }

  return (
    <div className="mt-6">
      {props.workspaces.length > 1 && (
        <label className="block text-sm">
          <span className="text-xs font-medium text-ink">Workspace</span>
          <select className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {props.workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      )}
      {chosen?.role === "reviewer" && <p className="mt-3 text-xs text-warning">You are a reviewer in this workspace, so {props.clientName} will only be able to read.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-error/20 bg-error-bg p-3 text-sm text-error">{error}</p>}
      <div className="mt-6 flex gap-3">
        <Button variant="primary" disabled={busy !== null || !workspaceId} onClick={() => answer(true)}>{busy === "approve" ? "Connecting…" : `Allow ${props.clientName}`}</Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => answer(false)}>{busy === "deny" ? "Cancelling…" : "Cancel"}</Button>
      </div>
    </div>
  );
}
