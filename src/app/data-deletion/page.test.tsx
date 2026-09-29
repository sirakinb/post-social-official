import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import DataDeletionPage from "./page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  deleteWorkspace: vi.fn(),
  session: null as { user?: { name?: string; email?: string } } | null,
  workspaces: undefined as Array<{ _id: string; name: string }> | undefined,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session, isPending: false }), signOut: mocks.signOut },
}));
vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => mocks.workspaces),
  useMutation: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useAction: vi.fn(() => mocks.deleteWorkspace),
}));
vi.mock("../../../convex/_generated/api", () => ({
  api: {
    workspaces: { mine: "workspaces.mine" },
    workspaceLifecycle: { deleteOwned: "workspaceLifecycle.deleteOwned" },
    users: { deleteEmptyProfile: "users.deleteEmptyProfile" },
  },
}));

describe("DataDeletionPage", () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.workspaces = undefined;
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.signOut.mockReset();
    mocks.signOut.mockResolvedValue({});
    mocks.deleteWorkspace.mockReset();
    mocks.deleteWorkspace.mockResolvedValue(undefined);
  });

  it("keeps workspace controls private when signed out", () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole("heading", { name: /Data Deletion/i })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to manage deletion/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/to confirm/i)).not.toBeInTheDocument();
  });

  it("requires exact-name confirmation and uses the revoking deletion action", async () => {
    mocks.session = { user: { email: "aki@example.com" } };
    mocks.workspaces = [{ _id: "ws1", name: "Exact Name" }];
    render(<DataDeletionPage />);
    const input = screen.getByLabelText(/Type Exact Name to confirm/i);
    const button = screen.getByRole("button", { name: /Delete workspace permanently/i });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "Exact Name" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.deleteWorkspace).toHaveBeenCalledWith({
      workspaceId: "ws1",
      confirmationName: "Exact Name",
    }));
  });

  it("signs out and returns to login", async () => {
    mocks.session = { user: { name: "Aki", email: "aki@example.com" } };
    mocks.workspaces = [];
    render(<DataDeletionPage />);
    fireEvent.click(screen.getByRole("button", { name: /Sign out/i }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
