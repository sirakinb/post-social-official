import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LogsFilters } from "./logs-filters";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const props = {
  areas: [{ value: "posts", label: "Posts" }, { value: "accounts", label: "Accounts" }],
  sources: [{ value: "api", label: "API" }, { value: "worker", label: "Publisher" }],
  people: [{ value: "a", label: "Aki" }, { value: "b", label: "claude-code-dev" }],
};

describe("LogsFilters", () => {
  it("is one row of a status switch and a dropdown per filter", () => {
    render(<LogsFilters {...props} values={{ level: "all", area: null, source: null, who: null }} />);
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("keeps the other filters when one changes, and resets them all", () => {
    push.mockClear();
    render(<LogsFilters {...props} values={{ level: "errors", area: "posts", source: null, who: null }} />);
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "worker" } });
    expect(push).toHaveBeenLastCalledWith("/beta/activity?level=errors&area=posts&source=worker");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(push).toHaveBeenLastCalledWith("/beta/activity");
  });

  it("hides the person filter when only one person has done anything", () => {
    render(<LogsFilters {...props} people={[{ value: "a", label: "Aki" }]} values={{ level: "all", area: null, source: null, who: null }} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });
});
