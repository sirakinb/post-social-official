import { describe, expect, it } from "vitest";
import { createConnectionsHandler, type ConnectionsHandlerDeps } from "./handler";

describe("connections function router", () => {
  const handler = createConnectionsHandler({ webAppHome: "https://www.postsocial.xyz/beta/accounts" } as unknown as ConnectionsHandlerDeps);

  it("refuses very long paths before any routing, quickly", async () => {
    const started = performance.now();
    const response = await handler(new Request(`https://fn/${"/".repeat(100_000)}a`));
    expect(response.status).toBe(404);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("still routes normal paths with a trailing slash", async () => {
    expect((await handler(new Request("https://fn/nothing-here/"))).status).toBe(404);
  });
});
