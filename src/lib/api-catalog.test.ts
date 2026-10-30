import { describe, expect, it } from "vitest";
import { API_CATALOG_TYPE, apiCatalog } from "./api-catalog";

describe("apiCatalog", () => {
  it("lists the REST API with its OpenAPI description and docs, and the MCP server with its docs", () => {
    const { linkset } = apiCatalog();
    expect(linkset).toHaveLength(2);
    expect(linkset[0]).toEqual({
      anchor: "https://www.postsocial.xyz/api/v1",
      "service-desc": [{ href: "https://www.postsocial.xyz/api/v1/openapi.json", type: "application/vnd.oai.openapi+json;version=3.1" }],
      "service-doc": [{ href: "https://www.postsocial.xyz/docs/api", type: "text/html" }],
    });
    expect(linkset[1]).toEqual({ anchor: "https://www.postsocial.xyz/mcp", "service-doc": [{ href: "https://www.postsocial.xyz/docs/connect", type: "text/html" }] });
    expect(API_CATALOG_TYPE.startsWith("application/linkset+json")).toBe(true);
  });
});
