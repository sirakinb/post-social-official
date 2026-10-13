import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Data Deletion · Post Social" };

const link = "text-accent hover:text-accent-hover underline";

export default function DataDeletionPage() {
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
          <p className="mt-2 text-sm text-ink-subtle">Last updated October 13, 2026</p>

          <div className="mt-8 space-y-6 text-ink-muted">
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Disconnect a connected account
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                In the app, go to{" "}
                <Link href="/beta/accounts" className={link}>Accounts</Link>{" "}
                and choose “Disconnect.” This deletes the stored sign-in tokens
                and stops future publishing to that account. Content already
                published on the platform remains on the platform.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                You can also remove Post Social from the platform itself, for
                example in TikTok’s “Manage app permissions” or Facebook’s
                “Apps and websites” settings. When Facebook or Instagram tells
                us you removed the app, we delete that account’s data
                automatically.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Delete a post or draft
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You can delete drafts and scheduled posts from the{" "}
                <Link href="/beta/drafts" className={link}>Drafts</Link> and{" "}
                <Link href="/beta/calendar" className={link}>Calendar</Link>{" "}
                pages. Deleting a post in Post Social does not remove it from
                the social network if it has already been published.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Delete your account and workspace
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Email{" "}
                <a href="mailto:support@postsocial.xyz?subject=Delete%20my%20Post%20Social%20data" className={link}>
                  support@postsocial.xyz
                </a>{" "}
                from the address you sign in with and ask us to delete your
                account. We revoke Post Social’s access on each connected
                platform, then delete your workspace, its members, connected
                accounts, posts, media and publishing history, and your
                sign-in. We confirm by email when it is done, within 30 days.
                This cannot be undone.
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
                  and stored encrypted sign-in tokens and account details.
                </li>
                <li>
                  Revoked: we attempt to revoke platform access for every
                  connected account before deleting it.
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
          </div>
        </article>
      </main>
    </div>
  );
}
