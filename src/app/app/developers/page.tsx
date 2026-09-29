"use client";

import { FormEvent, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Clipboard, Code2, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { friendlyErrorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE = "https://vibrant-donkey-218.convex.site/api/v1";
const MCP_URL = "https://vibrant-donkey-218.convex.site/mcp";

export default function DevelopersPage() {
  const workspace = useWorkspace();
  const keys = useQuery(api.apiKeys.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const createKey = useAction(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const webhooks = useQuery(api.webhooks.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const createWebhook = useAction(api.webhookActions.create);
  const removeWebhook = useMutation(api.webhooks.remove);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.workspaceId || workspace.mode !== "live") {
      setMessage("Sign in before creating a developer key.");
      return;
    }
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setBusy("create"); setMessage(null); setNewKey(null);
    try {
      const result = await createKey({ workspaceId: workspace.workspaceId, name });
      setNewKey(result.key);
      setMessage("Key created. Copy it now—Post Social will not show the full key again.");
      event.currentTarget.reset();
    } catch (cause) {
      setMessage(friendlyErrorMessage(cause, "The API key could not be created."));
    } finally { setBusy(null); }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function revoke(keyId: string) {
    if (!workspace.workspaceId || !window.confirm("Revoke this key? Any automation using it will stop immediately.")) return;
    setBusy(keyId); setMessage(null);
    try {
      await revokeKey({ workspaceId: workspace.workspaceId, keyId: keyId as Id<"apiKeys"> });
      setMessage("The key was revoked.");
    } catch (cause) {
      setMessage(friendlyErrorMessage(cause, "The key could not be revoked."));
    } finally { setBusy(null); }
  }

  async function addWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.workspaceId || workspace.mode !== "live") { setMessage("Sign in before creating a webhook."); return; }
    const data = new FormData(event.currentTarget);
    setBusy("webhook"); setMessage(null); setNewWebhookSecret(null);
    try {
      const result = await createWebhook({ workspaceId: workspace.workspaceId, url: String(data.get("url") ?? ""), description: String(data.get("description") ?? ""), events: ["destination.published", "destination.failed"] });
      setNewWebhookSecret(result.secret);
      setMessage("Webhook created. Copy the signing secret now—it will not be shown again.");
      event.currentTarget.reset();
    } catch (cause) { setMessage(friendlyErrorMessage(cause, "The webhook could not be created.")); }
    finally { setBusy(null); }
  }

  async function removeWebhookEndpoint(endpointId: string) {
    if (!workspace.workspaceId || !window.confirm("Remove this webhook? New delivery events will stop immediately.")) return;
    setBusy(endpointId); setMessage(null);
    try { await removeWebhook({ workspaceId: workspace.workspaceId, endpointId: endpointId as Id<"webhookEndpoints"> }); setMessage("The webhook was removed."); }
    catch (cause) { setMessage(friendlyErrorMessage(cause, "The webhook could not be removed.")); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-8 pb-10">
      <header className="stage-enter">
        <p className="utility-label text-accent">Post Social / Developers</p>
        <h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">Built for your tools<span className="scanline-accent">.</span></h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted">Connect an automation or AI assistant without giving it your social passwords. The same approval rules from Settings apply to every API and MCP request.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {[{ label: "REST API", value: "8 endpoints", icon: Code2 }, { label: "MCP tools", value: "10 tools", icon: ShieldCheck }, { label: "Token storage", value: "Encrypted", icon: KeyRound }].map((item) => <Card key={item.label}><CardContent className="flex items-center gap-4 p-5"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/35 bg-accent-muted text-accent"><item.icon className="h-4 w-4" /></span><div><p className="utility-label text-ink-subtle">{item.label}</p><p className="mt-1 font-semibold text-ink">{item.value}</p></div></CardContent></Card>)}
      </div>

      {message ? <div role="status" className="grooved-surface rounded-xl border border-accent/30 bg-accent-muted/40 p-4 text-sm text-ink">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader className="border-b border-border"><p className="utility-label text-ink-subtle">Private credentials</p><CardTitle className="mt-2">API keys</CardTitle><p className="text-sm leading-6 text-ink-muted">Name keys after the tool using them, then revoke access without disconnecting your social accounts.</p></CardHeader>
          <CardContent className="p-5">
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row"><Input name="name" aria-label="API key name" placeholder="Example: My Codex workspace" minLength={2} maxLength={60} required disabled={busy !== null} /><Button type="submit" variant="primary" disabled={busy !== null}>{busy === "create" ? "Creating…" : "Create key"}</Button></form>
            {newKey ? <div className="mt-5 rounded-lg border border-warning/35 bg-warning-bg p-4"><p className="utility-label text-warning">Shown once</p><code className="mt-3 block overflow-x-auto whitespace-nowrap rounded-md bg-canvas px-3 py-3 font-mono text-xs text-ink">{newKey}</code><Button className="mt-3" size="sm" variant="secondary" onClick={copyKey}>{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? "Copied" : "Copy key"}</Button></div> : null}
            <ul className="mt-6 divide-y divide-border border-t border-border">
              {keys?.map((key) => <li key={key._id} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{key.name}</p><p className="mt-1 font-mono text-[11px] text-ink-subtle">{key.keyPrefix}•••• · {key.revokedAt ? "revoked" : key.lastUsedAt ? "used recently" : "never used"}</p></div>{!key.revokedAt ? <Button aria-label={`Revoke ${key.name}`} size="sm" variant="danger" disabled={busy !== null} onClick={() => revoke(key._id)}><Trash2 className="h-4 w-4" />Revoke</Button> : null}</li>)}
              {workspace.mode === "demo" ? <li className="py-5 text-sm text-ink-muted">Sign in to create a private key. No sample key is embedded in this page.</li> : keys?.length === 0 ? <li className="py-5 text-sm text-ink-muted">No developer keys yet.</li> : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border"><p className="utility-label text-ink-subtle">Quickstart</p><CardTitle className="mt-2">Connect an AI assistant</CardTitle><p className="text-sm leading-6 text-ink-muted">Give the MCP address and one private key to your agent platform. It can draft, preview, schedule, publish, and inspect results within your approval rule.</p></CardHeader>
          <CardContent className="space-y-5 p-5">
            <div><p className="text-sm font-semibold text-ink">MCP server</p><code className="mt-2 block overflow-x-auto rounded-lg border border-border bg-canvas p-4 font-mono text-xs leading-6 text-accent">{MCP_URL}</code></div>
            <div><p className="text-sm font-semibold text-ink">Example configuration</p><pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-canvas p-4 font-mono text-xs leading-6 text-ink-muted">{`{
  "mcpServers": {
    "post-social": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}`}</pre></div>
            <div><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-ink">REST API</p><a href="/openapi.json" target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent hover:text-accent-hover">OpenAPI contract ↗</a></div><code className="mt-2 block overflow-x-auto rounded-lg border border-border bg-canvas p-4 font-mono text-xs leading-6 text-ink-muted">{API_BASE}</code></div>
            <p className="text-xs leading-5 text-ink-subtle">Keep keys in a secret manager or private environment variable. Never place a key in frontend code, screenshots, or a public repository.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border"><p className="utility-label text-ink-subtle">Delivery events</p><CardTitle className="mt-2">Webhooks</CardTitle><p className="max-w-3xl text-sm leading-6 text-ink-muted">Send a signed message to your automation when a destination publishes or needs attention. Failed deliveries retry after 30 seconds, 5 minutes, and 30 minutes.</p></CardHeader>
        <CardContent className="p-5">
          <form onSubmit={addWebhook} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]"><Input name="url" type="url" aria-label="Webhook URL" placeholder="https://example.com/post-social" required disabled={busy !== null} /><Input name="description" aria-label="Webhook description" placeholder="Example: Client reporting" maxLength={100} disabled={busy !== null} /><Button type="submit" variant="primary" disabled={busy !== null}>{busy === "webhook" ? "Creating…" : "Add webhook"}</Button></form>
          {newWebhookSecret ? <div className="mt-5 rounded-lg border border-warning/35 bg-warning-bg p-4"><p className="utility-label text-warning">Signing secret · shown once</p><code className="mt-3 block overflow-x-auto whitespace-nowrap rounded-md bg-canvas px-3 py-3 font-mono text-xs text-ink">{newWebhookSecret}</code><Button className="mt-3" size="sm" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(newWebhookSecret); setMessage("Webhook signing secret copied."); }}><Clipboard className="h-4 w-4" />Copy secret</Button></div> : null}
          <ul className="mt-6 divide-y divide-border border-t border-border">
            {webhooks?.map((endpoint) => <li key={endpoint._id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{endpoint.description}</p><p className="mt-1 truncate font-mono text-[11px] text-ink-subtle">{endpoint.url}</p><p className="mt-2 text-xs text-ink-muted">Published + failed · signature {endpoint.secretFingerprint}… · {endpoint.lastStatusCode ? `last response ${endpoint.lastStatusCode}` : "waiting for first event"}</p></div><Button size="sm" variant="danger" disabled={busy !== null} onClick={() => removeWebhookEndpoint(endpoint._id)}><Trash2 className="h-4 w-4" />Remove</Button></li>)}
            {workspace.mode === "demo" ? <li className="py-5 text-sm text-ink-muted">Sign in to create a signed webhook. The sample workspace does not send events.</li> : webhooks?.length === 0 ? <li className="py-5 text-sm text-ink-muted">No webhook endpoints yet.</li> : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
