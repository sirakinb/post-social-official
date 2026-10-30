import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// AI agents that ask for Markdown (Accept: text/markdown) get a Markdown version of a public
// page; browsers keep getting the normal page. Checked from inside the site, so it works behind
// staging's protection too.
test('an agent asking for Markdown gets Markdown, a browser gets the page', async ({ app, browser }) => {
  await app.open('/');
  const result = await browser.evaluate(async () => {
    const md = await fetch('/docs/quickstart', { headers: { Accept: 'text/markdown' } });
    const html = await fetch('/docs/quickstart', { headers: { Accept: 'text/html' } });
    const home = await fetch('/', { headers: { Accept: 'text/markdown' } });
    const app = await fetch('/markdown/beta/accounts');
    return {
      mdType: md.headers.get('content-type'),
      mdTokens: md.headers.get('x-markdown-tokens'),
      mdSignal: md.headers.get('content-signal'),
      mdBody: (await md.text()).slice(0, 600),
      htmlType: html.headers.get('content-type'),
      homeBody: (await home.text()).slice(0, 400),
      appStatus: app.status,
    };
  });
  expect(result.mdType).toContain('text/markdown');
  expect(Number(result.mdTokens)).toBeGreaterThan(100);
  expect(result.mdSignal).toBe('search=yes, ai-input=yes, ai-train=yes');
  expect(result.mdBody.startsWith('---\ntitle:')).toBe(true);
  expect(result.mdBody).toContain('# Quickstart: your first post');
  expect(result.mdBody).not.toContain('<div');
  expect(result.htmlType).toContain('text/html');
  expect(result.homeBody).toContain('# Social media management for AI-native creators and operators.');
  expect(result.appStatus).toBe(404);
});
