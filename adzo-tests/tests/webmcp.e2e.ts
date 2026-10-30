import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// WebMCP: in a browser that offers navigator.modelContext, the site registers its three tools
// on page load, and they answer. Chromium here doesn't have WebMCP yet, so a stand-in records
// what the page registers.
test('the site offers its WebMCP tools to an AI agent in the browser', async ({ app, browser }) => {
  await browser.addInitScript(() => {
    const tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> = {};
    (window as unknown as { __webmcp: typeof tools }).__webmcp = tools;
    (navigator as unknown as { modelContext: unknown }).modelContext = {
      registerTool: (tool: { name: string; execute: (input: unknown) => Promise<unknown> }) => {
        tools[tool.name] = tool;
        return Promise.resolve();
      },
    };
  });
  await app.open('/pricing');
  await new Promise((r) => setTimeout(r, 1500));
  const result = await browser.evaluate(async () => {
    const tools = (window as unknown as { __webmcp: Record<string, { execute: (input: unknown) => Promise<unknown> }> }).__webmcp;
    const price = (await tools.estimate_monthly_price.execute({ accounts: 5 })) as { monthly_total_usd: number };
    const docs = (await tools.search_docs.execute({ query: 'connect claude' })) as { results: Array<{ url: string }> };
    return { names: Object.keys(tools).sort(), price: price.monthly_total_usd, firstDoc: docs.results[0]?.url };
  });
  expect(result.names).toEqual(['estimate_monthly_price', 'open_page', 'search_docs']);
  expect(result.price).toBe(15);
  expect(result.firstDoc).toBe('https://www.postsocial.xyz/docs/connect');
});
