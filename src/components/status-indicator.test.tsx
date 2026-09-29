import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusIndicator } from "./status-indicator";

describe("StatusIndicator", () => {
  it("renders status text for screen readers and sighted users", () => {
    render(<StatusIndicator status="published" />);
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("uses the provided label", () => {
    render(<StatusIndicator status="failed" label="Needs attention" />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it.each([
    ["draft", "Draft"],
    ["scheduled", "Scheduled"],
    ["processing", "Processing"],
    ["published", "Published"],
    ["failed", "Failed"],
    ["partial", "Partially published"],
  ] as const)("maps %s to label %s", (status, expected) => {
    render(<StatusIndicator status={status} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
