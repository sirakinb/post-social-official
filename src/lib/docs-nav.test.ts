import { describe, expect, it } from "vitest";
import { DOCS_NAV, DOCS_PAGES, docsNeighbours, searchDocs } from "./docs-nav";

describe("docs map", () => {
  it("has the sidebar groups in order", () => {
    expect(DOCS_NAV.map((g) => g.title)).toEqual(["Get started", "Concepts", "Connect your AI", "Platforms", "Guides and recipes", "Troubleshooting", "API and CLI reference", "Billing"]);
  });
  it("lists each page once", () => {
    const hrefs = DOCS_PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const old of ["/docs", "/docs/quickstart", "/docs/billing", "/docs/connect", "/docs/cli", "/docs/api", "/docs/tools"]) expect(hrefs).toContain(old);
  });
  it("finds previous and next pages", () => {
    expect(docsNeighbours("/docs").previous).toBeUndefined();
    expect(docsNeighbours("/docs").next?.href).toBe("/docs/quickstart");
    expect(docsNeighbours("/docs/billing/").previous?.href).toBe("/docs/limits");
    expect(docsNeighbours("/docs/billing").next).toBeUndefined();
    expect(docsNeighbours("/elsewhere")).toEqual({ previous: undefined, next: undefined });
  });
  it("searches titles, descriptions and keywords", () => {
    expect(searchDocs("tiktok").map((p) => p.href)).toContain("/docs/platforms");
    expect(searchDocs("claude code").map((p) => p.href)).toContain("/docs/connect");
    expect(searchDocs("")).toEqual([]);
    expect(searchDocs("zzzzqq")).toEqual([]);
  });
});
