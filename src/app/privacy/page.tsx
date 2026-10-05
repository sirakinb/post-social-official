import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata = {
  title: "Privacy Policy — Post Social",
};

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-ink-subtle">Effective July 21, 2026 · Updated October 5, 2026</p>

          <div className="mt-8 space-y-6 text-ink-muted">
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                What we collect
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We collect the information you provide (name, email, workspace
                details) and the data required to publish on your behalf,
                including OAuth tokens, account handles, profile avatars, post
                content, media files, and publishing logs. If you join the
                waitlist, we keep the email address you give us to invite you.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                How connected-platform data is handled
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                TikTok, Instagram, Facebook, Threads, and YouTube provide only
                the data and permissions you approve on their consent screens. Post Social
                does not receive your social-network password. Access and
                refresh tokens are encrypted and kept on the server; they are
                never returned to the browser. We share post data with a
                connected platform only when needed to perform the publishing
                action you requested or approved.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Platform data categories
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                <li>
                  <strong className="text-ink">Identity:</strong> platform user
                  ID, display name, handle, avatar URL.
                </li>
                <li>
                  <strong className="text-ink">Tokens:</strong> OAuth access
                  and refresh tokens, encrypted server-side.
                </li>
                <li>
                  <strong className="text-ink">Content:</strong> captions,
                  media files, scheduled times, and publishing settings.
                </li>
                <li>
                  <strong className="text-ink">Results:</strong> status
                  updates, live post URLs, and sanitized error details.
                </li>
                <li>
                  <strong className="text-ink">Developer access:</strong> API
                  key hashes and prefixes, webhook URLs, encrypted webhook
                  signing secrets, delivery attempts, and request identifiers.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Google user data and YouTube API Services
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Post Social uses YouTube API Services to publish videos to your
                YouTube channel. When you connect YouTube, we request a single
                Google permission (the youtube.upload scope), which allows
                uploading videos you compose to your own channel. We do not read
                your channel, subscriber, or viewing data. The only Google user
                data we store are your OAuth access and refresh tokens, encrypted
                at rest (AES-256-GCM) on the server and never exposed to the
                browser, plus the video ID and public watch link of posts you
                publish. Google user data is shared only with YouTube itself to
                perform the upload you requested; it is never sold, used for
                advertising, or shared with other third parties.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                By using the YouTube connection you also agree to the{" "}
                <a
                  href="https://www.youtube.com/t/terms"
                  className="text-accent hover:text-accent-hover underline"
                >
                  YouTube Terms of Service
                </a>
                . Google&apos;s handling of your data is described in the{" "}
                <a
                  href="https://policies.google.com/privacy"
                  className="text-accent hover:text-accent-hover underline"
                >
                  Google Privacy Policy
                </a>
                . You can disconnect YouTube in Post Social at any time — we
                revoke our access with Google and delete the stored tokens — or
                revoke Post Social&apos;s access yourself from your{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  className="text-accent hover:text-accent-hover underline"
                >
                  Google security settings
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Service providers and security
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We use service providers only to operate Post Social: InsForge
                for the database, sign-in and backend; Cloudflare R2 for media
                storage; Vercel for hosting the website; Fly.io for the
                background service that publishes posts; and PostHog for
                product analytics and error reports. We limit stored permissions to the product features in
                use, encrypt platform credentials at rest, and keep a
                time-stamped security and publishing record. No internet
                service can guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Product analytics and error reports
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We use PostHog to understand how the website and app are used and
                to find bugs: pages visited, buttons used, errors, and session
                recordings of how pages are used. Recordings never include what
                you type, and inside the signed-in app they hide your text,
                images and videos, so they show where you click, not your posts.
                When you are signed in, this activity is linked to your account
                ID, never your email. Error reports from our servers contain the
                error and technical context, with tokens and keys removed. We do
                not use this data for advertising.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                How we use data
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We use your data only to operate the service: authenticating
                you, publishing posts, refreshing tokens, showing status, and
                maintaining an audit trail. If you configure a webhook, we send
                the selected publishing event and its safe result details to
                the URL you provide. We do not sell personal data.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Data retention and deletion
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We keep account data and posts until you delete them or close
                your workspace. You can disconnect individual accounts or delete
                your workspace to remove associated data. When a workspace is
                deleted, we attempt to revoke connected-platform access before
                removing locally stored encrypted credentials. Already-published
                content remains on the social platform and must be deleted
                there directly.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                Deletion-request receipts contain a one-way hash and a
                confirmation status and are retained for no more than 30 days.
                Expired OAuth state and rate-limit records are routinely purged.
                See the{" "}
                <Link
                  href="/data-deletion"
                  className="text-accent hover:text-accent-hover underline"
                >
                  data deletion
                </Link>{" "}
                page for details.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Your choices
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You may disconnect a social account at any time, delete an
                unpublished post and its unused media, delete a workspace, or
                delete your Post Social sign-in identity after all workspaces
                are removed. Disconnecting Post Social does not delete content
                already published on a third-party platform.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                Contact
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                For privacy questions, contact{" "}
                <a
                  href="mailto:aki.b@pentridgemedia.com"
                  className="text-accent hover:text-accent-hover underline"
                >
                  aki.b@pentridgemedia.com
                </a>
                .
              </p>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
