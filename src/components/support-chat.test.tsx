import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRISP_WEBSITE_ID, SupportChat, chatHiddenOn } from "./support-chat";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
// next/script adds its tag in the browser, so show it as a plain tag to see what it was given.
vi.mock("next/script", () => ({ default: (props: Record<string, unknown>) => createElement("script", { id: props.id as string }, props.children as string) }));

afterEach(() => {
  path.current = "/";
  delete (window as unknown as { $crisp?: unknown }).$crisp;
});

describe("SupportChat", () => {
  it("loads Crisp with our website id on the site, the docs and the app", () => {
    for (const p of ["/", "/pricing", "/docs/quickstart", "/beta/create", "/beta/login"]) {
      path.current = p;
      const { container, unmount } = render(<SupportChat />);
      const script = container.querySelector("script#crisp-chat");
      expect(script?.textContent).toContain(`CRISP_WEBSITE_ID="${CRISP_WEBSITE_ID}"`);
      expect(script?.textContent).toContain("https://client.crisp.chat/l.js");
      unmount();
    }
  });

  it("stays off the AI approval screen and hides a chat that is already open", () => {
    const push = vi.fn();
    (window as unknown as { $crisp: unknown }).$crisp = { push };
    path.current = "/oauth/authorize";
    const { container } = render(<SupportChat />);
    expect(container.querySelector("script")).toBeNull();
    expect(push).toHaveBeenCalledWith(["do", "chat:hide"]);
  });

  it("knows which pages hide it", () => {
    expect(chatHiddenOn("/oauth/authorize")).toBe(true);
    expect(chatHiddenOn("/tiktok-media/abc")).toBe(true);
    expect(chatHiddenOn("/oauthentic")).toBe(false);
    expect(chatHiddenOn("/beta/accounts")).toBe(false);
  });
});
