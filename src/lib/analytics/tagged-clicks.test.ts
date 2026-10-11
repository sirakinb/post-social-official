import { afterEach, describe, expect, it, vi } from "vitest";
import { trackTaggedClicks } from "./tagged-clicks";

describe("trackTaggedClicks", () => {
  let stop: (() => void) | undefined;
  afterEach(() => { stop?.(); document.body.innerHTML = ""; });

  it("sends the tag of the clicked element, including clicks on its children", () => {
    const capture = vi.fn();
    stop = trackTaggedClicks(capture);
    document.body.innerHTML = `<button data-attr="publish-now"><span id="inner">Publish</span></button>`;
    document.getElementById("inner")!.click();
    expect(capture).toHaveBeenCalledWith("button_clicked", { button: "publish-now" });
  });

  it("ignores untagged elements and tags that are not plain names", () => {
    const capture = vi.fn();
    stop = trackTaggedClicks(capture);
    document.body.innerHTML = `<button id="a">Plain</button><button id="b" data-attr="Maya's caption">X</button>`;
    document.getElementById("a")!.click();
    document.getElementById("b")!.click();
    expect(capture).not.toHaveBeenCalled();
  });

  it("stops listening when cleaned up", () => {
    const capture = vi.fn();
    trackTaggedClicks(capture)();
    document.body.innerHTML = `<button id="c" data-attr="schedule-post">Schedule</button>`;
    document.getElementById("c")!.click();
    expect(capture).not.toHaveBeenCalled();
  });
});
