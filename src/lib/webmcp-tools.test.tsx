import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WebMcpTools } from "@/components/webmcp-tools";
import { docsSearchResults, priceEstimate, WEBMCP_TOOLS } from "./webmcp-tools";

afterEach(() => {
  delete (navigator as unknown as { modelContext?: unknown }).modelContext;
});

describe("WebMCP tool actions", () => {
  it("searches the docs, falling back to the best partial matches", () => {
    expect(docsSearchResults("connect claude").results[0].url).toBe("https://www.postsocial.xyz/docs/connect");
    expect(docsSearchResults("how do I connect claude to post").results.length).toBeGreaterThan(0);
    expect(docsSearchResults("").results).toEqual([]);
  });

  it("estimates the monthly price the way the pricing page does", () => {
    expect(priceEstimate(2)).toMatchObject({ monthly_total_usd: 0, breakdown: [{ accounts: 2, usd_per_account: 0 }] });
    expect(priceEstimate(5)).toMatchObject({ monthly_total_usd: 15, breakdown: [{ accounts: 2, usd_per_account: 0 }, { accounts: 3, usd_per_account: 5 }] });
    expect(priceEstimate(12).breakdown).toEqual([{ accounts: 2, usd_per_account: 0 }, { accounts: 8, usd_per_account: 5 }, { accounts: 2, usd_per_account: 2.5 }]);
    expect(priceEstimate(-3).connected_accounts).toBe(0);
  });
});

describe("WebMcpTools", () => {
  it("registers the three tools where the browser supports WebMCP, and unregisters them on the way out", async () => {
    const registered: Array<{ tool: { name: string; execute: (i: unknown) => Promise<unknown> }; signal?: AbortSignal }> = [];
    (navigator as unknown as { modelContext: unknown }).modelContext = { registerTool: (tool: never, options?: { signal?: AbortSignal }) => { registered.push({ tool, signal: options?.signal }); return Promise.resolve(); } };
    const { unmount } = render(<WebMcpTools />);
    expect(registered.map((r) => r.tool.name)).toEqual(WEBMCP_TOOLS.map((t) => t.name));
    expect(await registered[1].tool.execute({ accounts: 3 })).toMatchObject({ monthly_total_usd: 5 });
    unmount();
    expect(registered.every((r) => r.signal?.aborted)).toBe(true);
  });

  it("does nothing in browsers without WebMCP", () => {
    expect(() => render(<WebMcpTools />)).not.toThrow();
  });
});
