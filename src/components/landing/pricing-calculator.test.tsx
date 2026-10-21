import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PricingCalculator, accountsAt, positionOf } from "./pricing-calculator";

describe("PricingCalculator", () => {
  it("starts free and spells out the bill as the slider moves", () => {
    render(<PricingCalculator initial={2} />);
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getByText("2 accounts free")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Number of connected accounts"), { target: { value: String(positionOf(12)) } });
    expect(screen.getByText("$45")).toBeInTheDocument();
    expect(screen.getByText("8 accounts × $5")).toBeInTheDocument();
    expect(screen.getByText("2 accounts × $2.50")).toBeInTheDocument();
  });
  it("maps every account count to the slider and back", () => {
    for (const n of [1, 2, 3, 10, 11, 57, 100, 101, 500, 2000]) expect(accountsAt(positionOf(n))).toBe(n);
    expect(accountsAt(0)).toBe(1);
    expect(accountsAt(1000)).toBe(2000);
  });
});
