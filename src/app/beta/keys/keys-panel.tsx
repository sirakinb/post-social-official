"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createKey, revokeKey, type KeySummary } from "./actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Never");

export function KeysPanel(props: { workspaceId: string; workspaceName: string; canManage: boolean; keys: KeySummary[]; loadError: boolean; mcpUrl: string; apiUrl: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"live" | "test">("live");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    const result = await createKey(props.workspaceId, name, mode);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setFresh({ name: result.data.name, key: result.data.key });
    setCopied(false);
    setName("");
    router.refresh();
  }

  async function revoke(key: KeySummary) {
    setBusy(key.id);
    setError(null);
    const result = await revokeKey(key.id);
    setBusy(null);
    setConfirming(null);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
  }

  const active = props.keys.filter((k) => !k.revoked_at);
  const revoked = props.keys.filter((k) => k.revoked_at);
  // Local and preview sites get their own name so they never clash with the live connector.
  const serverName = props.mcpUrl.startsWith("https://www.postsocial.xyz") ? "post-social" : "post-social-dev";
  const claudeCommand = `claude mcp add --transport http ${serverName} ${props.mcpUrl} --header "Authorization: Bearer ${fresh?.key ?? "YOUR_KEY"}"`;

  return (
    <div>
      <p className="utility-label text-accent">{props.workspaceName} / API keys</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-ink">API keys</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Keys let your AI tools and scripts use Post Social: Claude Code, Cursor, the REST API. Each key shows up by name in your activity. Posts an AI sends wait for your approval before they go out.
      </p>

      {error && <p role="alert" className="mt-6 rounded-lg border border-error/20 bg-error-bg p-3 text-sm text-error">{error}</p>}

      {fresh && (
        <section className="mt-6 rounded-xl border border-accent/40 bg-surface p-4" aria-label="Your new key">
          <p className="text-sm font-semibold text-ink">Copy your key for “{fresh.name}” now. It won&apos;t be shown again.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-canvas-ivory px-3 py-2 font-mono text-xs text-ink">{fresh.key}</code>
            <Button size="sm" variant="primary" onClick={() => copy(fresh.key)}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          <p className="mt-4 text-xs font-medium text-ink">Claude Code: run this in your terminal</p>
          <code className="mt-1 block break-all rounded-lg border border-border bg-canvas-ivory px-3 py-2 font-mono text-xs text-ink">{claudeCommand}</code>
          <Button className="mt-3" size="sm" variant="ghost" onClick={() => setFresh(null)}>I&apos;ve saved it</Button>
        </section>
      )}

      {props.canManage ? (
        <form onSubmit={create} className="grooved-surface mt-8 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
          <label className="min-w-[14rem] flex-1 text-sm">
            <span className="text-xs font-medium text-ink">Name</span>
            <Input className="mt-1" value={name} maxLength={80} required placeholder="e.g. Claude Code" onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="text-sm">
            <legend className="text-xs font-medium text-ink">Mode</legend>
            <div className="mt-1 flex gap-3">
              <label className="flex items-center gap-1.5 text-ink"><input type="radio" name="mode" checked={mode === "live"} onChange={() => setMode("live")} /> Live</label>
              <label className="flex items-center gap-1.5 text-ink"><input type="radio" name="mode" checked={mode === "test"} onChange={() => setMode("test")} /> Test (can&apos;t publish)</label>
            </div>
          </fieldset>
          <Button type="submit" variant="primary" disabled={busy !== null || !name.trim()}>{busy === "create" ? "Creating…" : "Create key"}</Button>
        </form>
      ) : (
        <p className="mt-8 text-sm text-ink-muted">Only owners and admins can create or revoke keys.</p>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink">Your keys</h2>
        {props.loadError ? (
          <p role="alert" className="mt-3 text-sm text-error">Your keys could not be loaded. Refresh the page to try again.</p>
        ) : active.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface p-8 text-center text-sm text-ink-muted">No keys yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {active.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{key.name}</p>
                  <p className="truncate font-mono text-xs text-ink-subtle">{key.prefix}…</p>
                  <p className="text-xs text-ink-subtle">Created {when(key.created_at)} · Last used {when(key.last_used_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={key.mode === "live" ? "success" : "default"}>{key.mode === "live" ? "Live" : "Test"}</Badge>
                  {props.canManage &&
                    (confirming === key.id ? (
                      <>
                        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => revoke(key)}>{busy === key.id ? "Revoking…" : "Confirm revoke"}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(key.id)}>Revoke</Button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && <p className="mt-3 text-xs text-ink-subtle">{revoked.length} revoked key{revoked.length === 1 ? "" : "s"}: {revoked.map((k) => k.name).join(", ")}.</p>}
      </section>

      <section className="mt-10 text-sm">
        <h2 className="font-semibold text-ink">Connect an AI</h2>
        <dl className="mt-3 grid gap-2 text-xs">
          <div><dt className="font-medium text-ink">MCP server</dt><dd className="font-mono text-ink-muted">{props.mcpUrl}</dd></div>
          <div><dt className="font-medium text-ink">REST API</dt><dd className="font-mono text-ink-muted">{props.apiUrl}/v1 · reference at {props.apiUrl}/v1/openapi.json</dd></div>
          <div><dt className="font-medium text-ink">Sign-in</dt><dd className="text-ink-muted">Send the key as a header: Authorization: Bearer ps_live_…</dd></div>
        </dl>
      </section>
    </div>
  );
}
