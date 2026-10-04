// Marks non-production deployments (Vercel Preview, local dev) so nobody mistakes
// dev data for the real thing. Renders nothing in production.
export function resolveAppEnv(
  appEnv = process.env.NEXT_PUBLIC_APP_ENV,
  vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV,
  nodeEnv = process.env.NODE_ENV,
) {
  if (appEnv) return appEnv;
  // Vercel exposes its own environment name if NEXT_PUBLIC_APP_ENV is ever missing.
  if (vercelEnv) return vercelEnv;
  return nodeEnv === "production" ? "production" : "development";
}

export function EnvironmentBadge({
  appEnv = resolveAppEnv(),
  insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL,
  convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL,
}: {
  appEnv?: string;
  insforgeUrl?: string;
  convexUrl?: string;
}) {
  if (appEnv === "production") return null;

  return (
    <div
      role="status"
      aria-label={`Environment: ${appEnv}`}
      className="fixed bottom-3 left-3 z-50 rounded-full bg-amber-400 px-3 py-1 font-mono text-xs font-semibold text-black shadow"
    >
      {appEnv} · InsForge {hostOf(insforgeUrl)}
      {/* Until the InsForge migration, every environment runs on the one live Convex deployment. */}
      {convexUrl ? " · LIVE Convex data" : null}
    </div>
  );
}

function hostOf(url: string | undefined) {
  if (!url) return "not set";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
