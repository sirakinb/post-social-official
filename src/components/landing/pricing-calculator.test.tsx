import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PricingCalculator } from "./pricing-calculator";

describe("PricingCalculator", () => {
  it("shows the monthly price for the chosen number of accounts", () => {
    render(<PricingCalculator initial={12} />);
    expect(screen.getByText("$45")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Number of connected accounts"), { target: { value: "2" } });
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText(/No card needed/)).toBeInTheDocument();
  });
  it("lights only the bands the accounts reach", () => {
    render(<PricingCalculator initial={5} />);
    expect(screen.getAllByText("not reached")).toHaveLength(2);
  });
});
