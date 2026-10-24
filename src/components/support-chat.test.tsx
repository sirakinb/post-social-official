import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportChatVisibility } from "./support-chat";
import { CRISP_SNIPPET, CRISP_WEBSITE_ID, chatHiddenOn } from "@/lib/support-chat";

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

  it("knows which pages hide it", () => {
    expect(chatHiddenOn("/oauth/authorize")).toBe(true);
    expect(chatHiddenOn("/tiktok-media/abc")).toBe(true);
    expect(chatHiddenOn("/oauthentic")).toBe(false);
    expect(chatHiddenOn("/beta/accounts")).toBe(false);
  });
});
