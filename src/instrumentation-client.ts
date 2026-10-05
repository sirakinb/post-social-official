// PostHog in the browser: page views, the waitlist funnel, session replays and error
// tracking. On only where NEXT_PUBLIC_POSTHOG_KEY is set (production), never locally.
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: "/ingest", // through this site (next.config.ts), so the content policy holds
    ui_host: "https://us.posthog.com",
    defaults: "2026-08-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
    session_recording: {
      // Never record what people type. Inside the signed-in app (marked data-ph-mask) hide
      // the text and pictures too: replays show where people click, not their posts.
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask], [data-ph-mask] *",
      blockSelector: "[data-ph-mask] img, [data-ph-mask] video",
    },
  });
  posthog.register({ environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development" });
}
