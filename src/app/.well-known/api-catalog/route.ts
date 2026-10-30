import { API_CATALOG_TYPE, apiCatalog } from "@/lib/api-catalog";

// RFC 9727: GET returns the catalog; HEAD returns just the headers, with a link to itself.
const headers = {
  "Content-Type": API_CATALOG_TYPE,
  "Cache-Control": "public, max-age=3600",
  Link: '</.well-known/api-catalog>; rel="api-catalog"',
};

export function GET() {
  return new Response(JSON.stringify(apiCatalog(), null, 2), { headers });
}

export function HEAD() {
  return new Response(null, { headers });
}
