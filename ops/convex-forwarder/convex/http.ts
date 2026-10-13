import { httpActionGeneric, httpRouter } from "convex/server";
import { META_PATHS, TIKTOK_CALLBACK, proxyToInsForge, tiktokRedirect } from "./forward";

const http = httpRouter();

http.route({ path: TIKTOK_CALLBACK, method: "GET", handler: httpActionGeneric(async (_ctx, request) => tiktokRedirect(request.url)) });

for (const path of Object.keys(META_PATHS)) {
  const method = path.endsWith("/status") ? "GET" : "POST";
  http.route({ path, method, handler: httpActionGeneric(async (_ctx, request) => proxyToInsForge(request)) });
}

export default http;
