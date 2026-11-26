// The address platforms reach us at: sign-in callbacks, Bluesky's client metadata and the
// status link in Meta's data-deletion answer.
//
// CONNECTIONS_PUBLIC_URL is the website (https://www.postsocial.xyz in prod), which forwards
// those paths to the connections function (next.config.ts). Platforms then only ever know our
// own domain, so the backend can move hosts without anything changing in their dashboards.
// Without it, platforms are sent to the function's own address (CONNECTIONS_BASE_URL).
export function publicConnectionsUrl(setting: (name: string) => string) {
  let site = "";
  try {
    site = (setting("CONNECTIONS_PUBLIC_URL") ?? "").trim();
  } catch {
    // Not set: fall back to the function's address.
  }
  return (site || setting("CONNECTIONS_BASE_URL")).replace(/\/+$/, "");
}
