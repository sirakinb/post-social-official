// Where each old Convex address now goes. TikTok's live app has only approved this
// deployment's callback, and Meta's data deletion and deauthorize callbacks were registered
// here, so these keep arriving at Convex until those settings change.
const CONNECTIONS = "https://syydd6ck.function2.insforge.app/connections";

export const TIKTOK_CALLBACK = "/api/oauth/tiktok/callback";
export const META_PATHS: Record<string, string> = {
  "/api/meta/data-deletion": "/meta/data-deletion",
  "/api/meta/data-deletion/status": "/meta/data-deletion/status",
  "/api/meta/deauthorize": "/meta/deauthorize",
};

// TikTok sign-ins go on to InsForge with every query parameter unchanged.
export function tiktokRedirect(requestUrl: string, base = CONNECTIONS) {
  const { search } = new URL(requestUrl);
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/oauth/tiktok/callback${search}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

// Meta's server-to-server calls can't follow a redirect, so they are passed through and
// InsForge's answer is returned as is (it checks Meta's signature itself).
export async function proxyToInsForge(request: Request, http: typeof fetch = fetch, base = CONNECTIONS) {
  const url = new URL(request.url);
  const target = META_PATHS[url.pathname];
  if (!target) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {};
  const type = request.headers.get("content-type");
  if (type) headers["content-type"] = type;
  const response = await http(`${base}${target}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.text(),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}
