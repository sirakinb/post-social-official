// "12 min ago" in the browser; plain dates on the server (it doesn't know the clock here).
export const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!now || minutes > 60 * 24 * 6) return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};
// For useSyncExternalStore: the minute clock never pushes updates, it is read on render.
export const subscribe = () => () => {};
