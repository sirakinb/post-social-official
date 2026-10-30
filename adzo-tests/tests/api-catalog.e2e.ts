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

test('the home page points agents to the catalog, and auth.md explains access', async ({ app, browser }) => {
  await app.open('/');
  const result = await browser.evaluate(async () => {
    const home = await fetch('/', { headers: { Accept: 'text/html' } });
    const auth = await fetch('/auth.md');
    return { links: home.headers.get('link'), authType: auth.headers.get('content-type'), authFirst: (await auth.text()).split('\n')[0] };
  });
  expect(result.links).toContain('</.well-known/api-catalog>; rel="api-catalog"');
  expect(result.authType).toContain('text/markdown');
  expect(result.authFirst).toBe('# Post Social auth.md');
});

test('OAuth resource metadata describes the site at the bare address and the MCP server at /mcp', async ({ app, browser }) => {
  await app.open('/');
  const result = await browser.evaluate(async () => {
    const root = await (await fetch('/.well-known/oauth-protected-resource')).json();
    const mcp = await (await fetch('/.well-known/oauth-protected-resource/mcp')).json();
    return { root: root.resource, mcp: mcp.resource, rootServers: root.authorization_servers, bearer: root.bearer_methods_supported };
  });
  expect(result.root.endsWith('/mcp')).toBe(false);
  expect(result.mcp.endsWith('/mcp')).toBe(true);
  expect(result.rootServers.length).toBe(1);
  expect(result.bearer).toEqual(['header']);
});

test('the MCP server card and the agent skills are published, with matching fingerprints', async ({ app, browser }) => {
  await app.open('/');
  const result = await browser.evaluate(async () => {
    const card = await (await fetch('/.well-known/mcp/server-card.json')).json();
    const index = await (await fetch('/.well-known/agent-skills/index.json')).json();
    const checks = [];
    for (const s of index.skills) {
      const text = await (await fetch(s.url)).arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', text))).map((b) => b.toString(16).padStart(2, '0')).join('');
      checks.push(s.digest === `sha256:${hash}`);
    }
    return { serverName: card.serverInfo?.name, endpoint: card.endpoint, tools: Boolean(card.capabilities?.tools), schema: index.$schema, skills: index.skills.map((s: { name: string }) => s.name), digestsMatch: checks };
  });
  expect(result.serverName).toBe('post-social');
  expect(result.endpoint).toBe('https://www.postsocial.xyz/mcp');
  expect(result.tools).toBe(true);
  expect(result.schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  expect(result.skills).toEqual(['connect-post-social', 'publish-a-post']);
  expect(result.digestsMatch).toEqual([true, true]);
});
