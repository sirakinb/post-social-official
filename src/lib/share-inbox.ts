// Files shared into the installed app (Android share sheet). public/sw.js keeps them in this
// phone's IndexedDB and opens Create; Create takes them out once and uploads them.
const DB = "post-social-share";
const STORE = "inbox";

export type Shared = { files: File[]; text: string };

export function takeShared(): Promise<Shared | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get("latest");
      let entry: { files?: File[]; text?: string; at?: number } | undefined;
      get.onsuccess = () => {
        entry = get.result;
        store.delete("latest");
      };
      tx.oncomplete = () => {
        open.result.close();
        // Only a share from the last hour: an old leftover shouldn't appear in a new post.
        if (!entry || !entry.at || Date.now() - entry.at > 3600_000) return resolve(null);
        resolve({ files: (entry.files ?? []).filter((f) => f instanceof Blob), text: entry.text ?? "" });
      };
      tx.onerror = () => resolve(null);
    };
  });
}
