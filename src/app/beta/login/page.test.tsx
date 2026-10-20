import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BetaLoginPage, { metadata } from "./page";

vi.mock("../forms", () => ({ SignInForm: () => null }));

describe("BetaLoginPage", () => {
  it("uses plain product copy, with no talk of a new version or backend", async () => {
    const { container } = render(await BetaLoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Sign in to Post Social" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/new version|new backend|the new Post Social/i);
    expect(metadata.title).toBe("Sign in · Post Social");
  });
});
