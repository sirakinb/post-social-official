// Marks non-production deployments (Vercel Preview, local dev) so nobody mistakes
// dev data for the real thing. Renders nothing in production.
export function EnvironmentBadge({
  appEnv = process.env.NEXT_PUBLIC_APP_ENV,
  backendUrl = process.env.NEXT_PUBLIC_INSFORGE_URL,
}: {
  appEnv?: string;
  backendUrl?: string;
}) {
  if (!appEnv || appEnv === "production") return null;

  return (
    <div
      role="status"
      aria-label={`Environment: ${appEnv}`}
      className="fixed bottom-3 left-3 z-50 rounded-full bg-amber-400 px-3 py-1 font-mono text-xs font-semibold text-black shadow"
    >
      {appEnv} · {hostOf(backendUrl)}
    </div>
  );
}

function hostOf(url: string | undefined) {
  if (!url) return "no backend set";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
