import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BetaSignupPage from "./page";

vi.mock("../forms", () => ({ SignUpForm: () => <p>email form</p>, GoogleButton: () => <p>google</p>, OrDivider: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

afterEach(() => vi.unstubAllEnvs());

describe("BetaSignupPage", () => {
  it("offers email sign-up when sign-up is open, with Google hidden for now", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "on");
    render(await BetaSignupPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Start for free" })).toBeInTheDocument();
    expect(screen.queryByText("google")).not.toBeInTheDocument();
    expect(screen.getByText("email form")).toBeInTheDocument();
  });
  it("does not exist while the site is invite-only", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "");
    await expect(BetaSignupPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
});
