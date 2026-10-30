import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Software can find Post Social's APIs at /.well-known/api-catalog (RFC 9727), and the
// OpenAPI description it points to answers.
test('the API catalog lists the REST API and MCP server', async ({ app, browser }) => {
  await app.open('/');
  const result = await browser.evaluate(async () => {
    const r = await fetch('/.well-known/api-catalog');
    const body = await r.json();
    const spec = await fetch(body.linkset[0]['service-desc'][0].href.replace('https://www.postsocial.xyz', ''));
    return { status: r.status, type: r.headers.get('content-type'), anchors: body.linkset.map((e: { anchor: string }) => e.anchor), specStatus: spec.status };
  });
  expect(result.status).toBe(200);
  expect(result.type).toContain('application/linkset+json');
  expect(result.anchors).toEqual(['https://www.postsocial.xyz/api/v1', 'https://www.postsocial.xyz/mcp']);
  expect(result.specStatus).toBe(200);
});
