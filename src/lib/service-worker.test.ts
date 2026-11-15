// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Runs public/sw.js against a fake service worker scope and returns its fetch handler.
function loadWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const kept: unknown[] = [];
  const self = { location: { origin: "https://www.postsocial.xyz" }, addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn), skipWaiting: () => {}, clients: { claim: async () => {} } };
  // IndexedDB that records what would be kept.
  const indexedDB = {
    open: () => {
      const request: Record<string, unknown> = {};
      const tx: Record<string, unknown> = { objectStore: () => ({ put: (entry: unknown) => kept.push(entry) }) };
      request.result = { transaction: () => tx, close: () => {}, createObjectStore: () => {} };
      queueMicrotask(() => {
        (request.onsuccess as () => void)();
        queueMicrotask(() => (tx.oncomplete as () => void)());
      });
      return request;
    },
  };
  const source = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  new Function("self", "indexedDB", source)(self, indexedDB);
  const share = async (referrer: string) => {
    const form = new FormData();
    form.append("media", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
    form.append("text", "Look at this");
    const request = new Request("https://www.postsocial.xyz/beta/share", { method: "POST", body: form });
    Object.defineProperty(request, "referrer", { value: referrer });
    let answer: Promise<Response> | undefined;
    listeners.fetch({ request, respondWith: (r: Promise<Response>) => (answer = r) });
    return answer!;
  };
  return { share, kept };
}

describe("share target in the service worker", () => {
  it("keeps files shared from the phone's share sheet (no referrer) and opens Create", async () => {
    const { share, kept } = loadWorker();
    const response = await share("");
    expect(response.headers.get("location")).toBe("https://www.postsocial.xyz/beta/create?shared=1");
    expect(kept).toHaveLength(1);
  });

  it("accepts a share posted from this site", async () => {
    const { share, kept } = loadWorker();
    await share("https://www.postsocial.xyz/beta/create");
    expect(kept).toHaveLength(1);
  });

  it("turns away a form posted from another site, keeping nothing", async () => {
    const { share, kept } = loadWorker();
    const response = await share("https://evil.example/page");
    expect(response.headers.get("location")).toBe("https://www.postsocial.xyz/beta/create");
    expect(kept).toHaveLength(0);
  });
});
