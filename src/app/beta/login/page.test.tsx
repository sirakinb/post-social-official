import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BetaLoginPage, { metadata } from "./page";

vi.mock("../forms", () => ({ SignInForm: () => null, GoogleButton: () => <p>google</p>, OrDivider: () => null }));

afterEach(() => vi.unstubAllEnvs());

describe("BetaLoginPage", () => {
  it("uses plain product copy, with no talk of a new version or backend", async () => {
    const { container } = render(await BetaLoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Sign in to Post Social" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/new version|new backend|the new Post Social/i);
    expect(metadata.title).toBe("Sign in · Post Social");
  });
  it("stays invite-only, with no Google button, until sign-up is opened", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "");
    const { container } = render(await BetaLoginPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toMatch(/invite-only/);
    expect(screen.queryByText("google")).not.toBeInTheDocument();
  });
  it("is email only once sign-up is open, until Google sign-in is switched on", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "on");
    const { container } = render(await BetaLoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("google")).not.toBeInTheDocument();
    expect(container.textContent).toMatch(/Sign in with your email and password/);
    expect(container.textContent).not.toMatch(/invite-only/);
  });
});
