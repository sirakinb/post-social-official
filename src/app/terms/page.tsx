import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata = {
  title: "Terms of Service — Post Social",
};

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-ink-subtle">Effective July 21, 2026 · Updated August 4, 2026</p>

          <div className="mt-8 space-y-6 text-ink-muted">
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                1. Acceptance of terms
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                By accessing or using Post Social, you agree to be bound by these
                terms. If you do not agree, do not use the service.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                2. Description of service
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Post Social lets you connect supported social accounts, prepare
                and schedule content, approve publishing, and view platform
                results from one workspace. It also provides API, MCP, and
                webhook access for tools you authorize. The service is provided
                by Pentridge Media.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                3. User responsibilities
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You are responsible for the content you publish, for complying
                with the terms of each connected platform, and for maintaining
                the security of your account credentials, API keys, and webhook
                signing secrets. Actions taken with one of your active developer
                keys are treated as authorized workspace actions.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                4. Platform connections
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Post Social connects to third-party platforms such as TikTok,
                Instagram, Facebook Pages, Threads, and YouTube through OAuth. We
                act on your behalf only after you have granted permission and
                according to the workspace or account-level approval rule you
                select.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                Post Social uses YouTube API Services. By connecting a YouTube
                channel, you also agree to the{" "}
                <a
                  href="https://www.youtube.com/t/terms"
                  className="text-accent hover:text-accent-hover underline"
                >
                  YouTube Terms of Service
                </a>
                . The{" "}
                <a
                  href="https://policies.google.com/privacy"
                  className="text-accent hover:text-accent-hover underline"
                >
                  Google Privacy Policy
                </a>{" "}
                describes how Google handles your data, and you can revoke Post
                Social&apos;s access at any time from your{" "}
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
                5. Your content and acceptable use
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                You retain ownership of content you upload. You give Post Social
                the limited permission needed to store, process, and transmit
                that content to the destinations you choose. You may not use the
                service for unlawful content, infringement, impersonation,
                spam, platform manipulation, or attempts to bypass a connected
                platform’s rules or publishing limits.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                6. Availability and account access
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Social platforms may change permissions, limits, review status,
                or availability. We cannot guarantee that every platform will
                accept every post. You may disconnect platform access or delete
                your Post Social data using the controls described on our data
                deletion page. We may suspend access needed to protect the
                service, users, or third parties from misuse.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                7. Limitation of liability
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Post Social is provided “as is.” To the extent permitted by law,
                Pentridge Media is not liable for indirect, incidental, or
                consequential damages arising from your use of the service.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                8. Changes to terms
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                We may update these terms from time to time. Continued use after
                changes constitutes acceptance of the revised terms.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold text-ink">
                9. Contact
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                Questions about these terms may be sent to{" "}
                <a href="mailto:aki.b@pentridgemedia.com" className="text-accent hover:text-accent-hover underline">aki.b@pentridgemedia.com</a>.
              </p>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
