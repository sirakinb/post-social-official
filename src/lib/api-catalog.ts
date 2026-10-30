import { API_URL, MCP_URL, SITE } from "@/lib/api-docs";

// The API catalog (RFC 9727) at /.well-known/api-catalog: where software finds Post Social's
// APIs, their machine-readable descriptions and their docs. There is no public status page yet;
// add a "status" link to each entry once there is.
export const API_CATALOG_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

export function apiCatalog() {
  return {
    linkset: [
      {
        anchor: API_URL,
        "service-desc": [{ href: `${API_URL}/openapi.json`, type: "application/vnd.oai.openapi+json;version=3.1" }],
        "service-doc": [{ href: `${SITE}/docs/api`, type: "text/html" }],
      },
      {
        anchor: MCP_URL,
        "service-doc": [{ href: `${SITE}/docs/connect`, type: "text/html" }],
      },
    ],
  };
}
