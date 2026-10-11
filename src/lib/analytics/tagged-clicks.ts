// Clicks on elements tagged with data-attr (publish, schedule, connect, ...) become a
// "button_clicked" event named by the tag. Autocapture can't carry the tag because
// mask_all_element_attributes strips every attribute, and only our own tags are sent here.
const TAG = /^[a-z0-9-]{1,64}$/;

export function trackTaggedClicks(
  capture: (event: string, properties: Record<string, unknown>) => void,
  root: Document = document,
): () => void {
  const onClick = (e: Event) => {
    const target = e.target instanceof Element ? e.target.closest("[data-attr]") : null;
    const button = target?.getAttribute("data-attr");
    if (!button || !TAG.test(button)) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    capture("button_clicked", { button });
  };
  root.addEventListener("click", onClick, true);
  return () => root.removeEventListener("click", onClick, true);
}
