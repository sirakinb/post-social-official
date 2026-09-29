"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { friendlyErrorMessage } from "@/lib/error-message";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default function DataDeletionPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const workspaces = useQuery(api.workspaces.mine, session ? {} : "skip");

  async function handleSignOut() {
    const result = await authClient.signOut();
    if (result.error) return;
    router.push("/login");
    router.refresh();
  }
  const deleteWorkspace = useAction(api.workspaceLifecycle.deleteOwned);
  const deleteProfile = useMutation(api.users.deleteEmptyProfile);
  const [confirmation, setConfirmation] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function removeWorkspace(workspaceId: Id<"workspaces">, name: string) {
    if (confirmation[workspaceId] !== name) return;
    setBusy(workspaceId); setMessage(null);
    try {
      await deleteWorkspace({ workspaceId, confirmationName: confirmation[workspaceId] });
      setMessage({ kind: "success", text: `${name} and its stored publishing data were deleted.` });
    } catch (cause) {
      setMessage({ kind: "error", text: friendlyErrorMessage(cause, "The workspace could not be deleted.") });
    } finally { setBusy(null); }
  }

  async function removeSignIn() {
    setBusy("identity"); setMessage(null);
    try {
      await deleteProfile({});
      const result = await authClient.deleteUser();
      if (result.error) throw new Error(result.error.message ?? "Your sign-in could not be deleted.");
      window.location.href = "/";
    } catch (cause) {
      setMessage({ kind: "error", text: friendlyErrorMessage(cause, "Your sign-in could not be deleted.") });
      setBusy(null);
    }
  }
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 md:px-8">
          <Brand size="sm" />
          <Link
            href="/"
            className="text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md px-2 py-1"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <article className="rounded-2xl border border-border bg-surface p-8 md:p-12">
          <h1 className="font-display text-3xl font-semibold text-ink">
            Data Deletion
          </h1>
          <p className="mt-2 text-sm text-ink-subtle">Last updated July 21, 2026</p>

          <div className="mt-8 space-y-6 text-ink-muted">
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Disconnect a connected account
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                In the app, go to{" "}
                <Link
                  href="/app/accounts"
                  className="text-accent hover:text-accent-hover underline"
                >
                  Accounts
                </Link>{" "}
                and select “Disconnect.” This removes the OAuth tokens and
                stops future publishing to that account. Content already
                published on the platform remains on the platform.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Delete a post or draft
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You can delete drafts and scheduled posts from the Activity
                view. Deleting a post in Post Social does not remove
                it from the social network if it has already been published.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Delete your workspace
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Deleting your workspace first attempts to revoke Post Social’s
                access on each connected platform, then removes workspace
                members, connected accounts, posts, media, and publishing
                history from our systems. This action is irreversible. Content
                already published on a third-party platform remains there.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                What is removed and what remains
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                <li>
                  Removed: workspace members, connected accounts, drafts,
                  scheduled posts, media stored in Post Social, activity logs,
                  and locally stored encrypted OAuth tokens and account
                  metadata.
                </li>
                <li>
                  Revoked: we attempt to revoke platform access for connected
                  accounts as part of workspace deletion.
                </li>
                <li>
                  Retained briefly: a one-way hash and confirmation status of
                  the deletion request, kept for no more than 30 days.
                </li>
                <li>
                  Remains: content already published to third-party platforms,
                  which you must delete on those platforms directly.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Request deletion
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You can remove your data below when signed in. Deletion
                confirmations use a one-way hash and are retained for up to 30
                days. If you cannot access your account, contact us at{" "}
                <a
                  href="mailto:aki.b@pentridgemedia.com"
                  className="text-accent hover:text-accent-hover underline"
                >
                  aki.b@pentridgemedia.com
                </a>
                .
              </p>
              {message && <p role={message.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-error/30 bg-error-bg text-error" : "border-success/30 bg-success-bg text-success"}`}>{message.text}</p>}
              {!isPending && !session ? (
                <Button asChild variant="primary" className="mt-4"><Link href="/login">Sign in to manage deletion</Link></Button>
              ) : null}
              {session && !isPending ? (
                <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-surface-raised p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="text-xs text-ink-subtle">Signed in as</p>
                    <p className="truncate font-semibold text-ink">{session.user.name || session.user.email}</p>
                  </div>
                  <Button variant="secondary" className="shrink-0" onClick={handleSignOut}>Sign out</Button>
                </div>
              ) : null}
              {session && workspaces ? (
                <div className="mt-5 space-y-4">
                  {workspaces.map((workspace) => (
                    <div key={workspace._id} className="grooved-surface rounded-xl border border-border bg-surface-raised p-4">
                      <p className="font-semibold text-ink">Delete {workspace.name}</p>
                      <p className="mt-1 text-xs text-ink-subtle">Type the workspace name exactly. Stored media, tokens, drafts, schedules, and activity will be permanently removed.</p>
                      <Input className="mt-3" value={confirmation[workspace._id] ?? ""} onChange={(event) => setConfirmation((current) => ({ ...current, [workspace._id]: event.target.value }))} placeholder={workspace.name} aria-label={`Type ${workspace.name} to confirm`} />
                      <Button variant="danger" className="mt-3" disabled={busy !== null || confirmation[workspace._id] !== workspace.name} onClick={() => removeWorkspace(workspace._id, workspace.name)}>{busy === workspace._id ? "Deleting workspace…" : "Delete workspace permanently"}</Button>
                    </div>
                  ))}
                  {workspaces.length === 0 ? (
                    <div className="rounded-xl border border-border p-4">
                      <p className="font-semibold text-ink">Delete sign-in identity</p>
                      <p className="mt-1 text-xs text-ink-subtle">This removes your Post Social login after all workspaces are gone.</p>
                      <Button variant="danger" className="mt-3" disabled={busy !== null} onClick={removeSignIn}>{busy === "identity" ? "Deleting sign-in…" : "Delete my Post Social account"}</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
