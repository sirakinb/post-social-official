import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UnsubscribePage from "./page";

vi.mock("./actions", () => ({ unsubscribe: async () => ({ ok: true }) }));

describe("UnsubscribePage", () => {
  it("asks for a click instead of unsubscribing on opening (email scanners open links)", async () => {
    render(await UnsubscribePage({ searchParams: Promise.resolve({ u: "user", t: "token" }) }));
    expect(screen.getByRole("heading", { name: "Unsubscribe from tips emails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeInTheDocument();
  });

  it("explains a broken link", async () => {
    render(await UnsubscribePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    expect(screen.getByText(/This link is missing something/)).toBeInTheDocument();
  });
});
