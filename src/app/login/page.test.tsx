import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import LoginPage from "./page";

const { push, refresh, signInEmail } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmail } },
}));

describe("LoginPage", () => {
  it("keeps sign-in and removes public self-service sign-up", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create account/i })).not.toBeInTheDocument();
  });

  it("links Create account to Pentridge Labs in the same tab", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /Create account/i });
    expect(link).toHaveAttribute("href", "https://www.pentridgemedia.com/labs");
    expect(link).not.toHaveAttribute("target", "_blank");
  });

  it("explains that access comes through Pentridge Labs membership", () => {
    render(<LoginPage />);
    expect(screen.getByText(/New access is granted through Pentridge Labs membership/i)).toBeInTheDocument();
  });
});
