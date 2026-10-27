import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportChatVisibility } from "./support-chat";
import { CRISP_SNIPPET, CRISP_WEBSITE_ID, chatHiddenOn, chatHiddenOnPhone } from "@/lib/support-chat";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

afterEach(() => {
  path.current = "/";
  delete (window as unknown as { $crisp?: unknown }).$crisp;
});

describe("Crisp snippet", () => {
  it("is Crisp's loader with our website id", () => {
    expect(CRISP_SNIPPET).toContain(`window.CRISP_WEBSITE_ID="${CRISP_WEBSITE_ID}"`);
    expect(CRISP_SNIPPET).toContain("https://client.crisp.chat/l.js");
  });

  it("starts hidden on the AI approval screen, and adds the loader only once", () => {
    const run = (pathname: string) => {
      window.history.replaceState(null, "", pathname);
      (window as unknown as { $crisp?: unknown }).$crisp = undefined;
      new Function(CRISP_SNIPPET)();
      return (window as unknown as { $crisp: unknown[][] }).$crisp;
    };
    expect(run("/oauth/authorize")).toContainEqual(["do", "chat:hide"]);
    expect(run("/")).toEqual(expect.arrayContaining([["config", "color:theme", ["deep_purple"]], ["config", "color:mode", ["dark"]]]));
    expect(run("/pricing")).not.toContainEqual(["do", "chat:hide"]);
    expect(document.querySelectorAll("script#crisp-loader")).toHaveLength(1);
  });
});

describe("SupportChatVisibility", () => {
  it("hides the chat on the AI approval screen and shows it elsewhere", () => {
    const push = vi.fn();
    (window as unknown as { $crisp: unknown }).$crisp = { push };
    path.current = "/oauth/authorize";
    const { rerender } = render(<SupportChatVisibility />);
    expect(push).toHaveBeenLastCalledWith(["do", "chat:hide"]);
    path.current = "/beta/create";
    rerender(<SupportChatVisibility />);
    expect(push).toHaveBeenLastCalledWith(["do", "chat:show"]);
  });

  it("hides the chat on the composer on phones only, where it would cover the Post button", () => {
    const push = vi.fn();
    (window as unknown as { $crisp: unknown }).$crisp = { push };
    const listeners: Array<() => void> = [];
    const media = { matches: true, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => {} };
    window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
    path.current = "/beta/create";
    render(<SupportChatVisibility />);
    expect(push).toHaveBeenLastCalledWith(["do", "chat:hide"]);
    media.matches = false;
    act(() => listeners.forEach((f) => f()));
    expect(push).toHaveBeenLastCalledWith(["do", "chat:show"]);
    expect(chatHiddenOnPhone("/beta/create")).toBe(true);
    expect(chatHiddenOnPhone("/beta/accounts")).toBe(false);
  });

  it("knows which pages hide it", () => {
    expect(chatHiddenOn("/oauth/authorize")).toBe(true);
    expect(chatHiddenOn("/tiktok-media/abc")).toBe(true);
    expect(chatHiddenOn("/oauthentic")).toBe(false);
    expect(chatHiddenOn("/beta/accounts")).toBe(false);
  });
});
