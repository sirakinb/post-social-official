import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { AuthenticatedApp } from "./authenticated-app";

const auth = vi.hoisted(() => ({ state: "unauthenticated" as "loading" | "authenticated" | "unauthenticated" }));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("convex/react", () => ({
  AuthLoading: ({ children }: { children: React.ReactNode }) => auth.state === "loading" ? <>{children}</> : null,
  Authenticated: ({ children }: { children: React.ReactNode }) => auth.state === "authenticated" ? <>{children}</> : null,
  Unauthenticated: ({ children }: { children: React.ReactNode }) => auth.state === "unauthenticated" ? <>{children}</> : null,
  useMutation: () => vi.fn().mockResolvedValue(undefined),
  useQuery: () => undefined,
}));
vi.mock("@/components/workspace-provider", () => ({ WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

describe("AuthenticatedApp", () => {
  beforeEach(() => { auth.state = "unauthenticated"; });

  it("does not render private children while auth is loading", () => {
    auth.state = "loading";
    render(<AuthenticatedApp><div>Private workspace</div></AuthenticatedApp>);
    expect(screen.getByText("Checking sign-in…")).toBeInTheDocument();
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
  });

  it("shows a sign-in screen and no private children when unauthenticated", () => {
    render(<AuthenticatedApp><div>Private workspace</div></AuthenticatedApp>);
    expect(screen.getByRole("heading", { name: /Sign in required/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
  });

  it("renders children only after authentication", async () => {
    auth.state = "authenticated";
    render(<AuthenticatedApp><div>Private workspace</div></AuthenticatedApp>);
    await waitFor(() => expect(screen.getByText("Private workspace")).toBeInTheDocument());
  });
});
