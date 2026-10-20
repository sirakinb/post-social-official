// Post Social's service worker. Its only job: receive photos and videos shared to the
// installed app from another app's share sheet (Android), keep them on the phone, and open
// Create, which uploads them (src/lib/share-inbox.ts reads what is kept here). Every other
// request goes to the network untouched; nothing is cached.
const DB = "post-social-share";
const STORE = "inbox";

function keep(entry) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, "latest");
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/beta/share") return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll("media").filter((f) => typeof f === "object" && f.size > 0);
        const text = ["title", "text", "url"].map((k) => form.get(k)).filter((v) => typeof v === "string" && v.trim()).join("\n");
        await keep({ files, text, at: Date.now() });
        return Response.redirect(new URL("/beta/create?shared=1", self.location.origin).href, 303);
      } catch {
        return Response.redirect(new URL("/beta/create?shared=failed", self.location.origin).href, 303);
      }
    })(),
  );
});
