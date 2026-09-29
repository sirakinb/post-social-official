import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppShell } from "./app-shell";

const { push, refresh, signOut } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: "Aki Bajulaiye", email: "aki@example.com" } }, isPending: false }),
    signOut,
  },
}));

describe("AppShell", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    signOut.mockReset();
    signOut.mockResolvedValue({});
  });
  it("renders navigation links", () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>
    );
    const desktopNav = screen.getByRole("navigation", { name: /App navigation/i });
    const withinNav = within(desktopNav);
    expect(withinNav.getByRole("link", { name: /Home/i })).toBeInTheDocument();
    expect(withinNav.getByRole("link", { name: /Create/i })).toBeInTheDocument();
    expect(withinNav.getByRole("link", { name: /Calendar/i })).toBeInTheDocument();
    expect(withinNav.getByRole("link", { name: /Accounts/i })).toBeInTheDocument();
    expect(withinNav.getByRole("link", { name: /Activity/i })).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("marks the current page", () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>
    );
    const desktopNav = screen.getByRole("navigation", { name: /App navigation/i });
    const homeLink = within(desktopNav).getByRole("link", { name: /Home/i });
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });

  it("shows the signed-in user and signs out", async () => {
    render(<AppShell><div>Child content</div></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByText("Aki Bajulaiye")).toBeInTheDocument();
    fireEvent.click(within(sidebar).getByRole("button", { name: /Sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/login");
    expect(refresh).toHaveBeenCalled();
  });
});
