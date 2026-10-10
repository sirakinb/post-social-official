import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SymbolMark, symbolFor } from "./symbol-mark";

describe("SymbolMark", () => {
  it("gives the same seed the same mark, and spreads different seeds out", () => {
    expect(symbolFor("ws-1")).toEqual(symbolFor("ws-1"));
    const marks = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(symbolFor(`workspace-${i}`))));
    expect(marks.size).toBeGreaterThan(20);
  });

  it("draws a symbol, never a letter", () => {
    const { container } = render(<SymbolMark seed="Pentridge Media" title="Pentridge Media" />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Pentridge Media");
    expect(container.textContent).toBe("Pentridge Media");
    expect(container.querySelector("text")).toBeNull();
  });
});
