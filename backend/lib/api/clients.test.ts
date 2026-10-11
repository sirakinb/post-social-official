import { describe, expect, it } from "vitest";
import { clientLabel } from "./clients";

describe("clientLabel", () => {
  it("names the apps people know", () => {
    expect(clientLabel({ name: "claude-code", version: "2.1.0" })).toBe("Claude Code");
    expect(clientLabel({ name: "claude-ai" })).toBe("Claude");
    expect(clientLabel({ name: "codex-mcp-client" })).toBe("Codex");
    expect(clientLabel({ name: "openai-mcp" })).toBe("ChatGPT");
    expect(clientLabel({ name: "cursor-vscode" })).toBe("Cursor");
    expect(clientLabel({ name: "gemini-cli-mcp-client" })).toBe("Gemini CLI");
    expect(clientLabel({ name: "Visual Studio Code" })).toBe("GitHub Copilot");
  });

  it("keeps any other app's own name, cleaned up and short", () => {
    expect(clientLabel({ name: "my-agent", title: "My Agent" })).toBe("My Agent");
    expect(clientLabel({ name: "<b>Bot</b>" })).toBe("bBotb");
    expect(clientLabel({ name: "x".repeat(200) })).toHaveLength(80);
  });

  it("gives nothing when the app didn't say", () => {
    expect(clientLabel(undefined)).toBeNull();
    expect(clientLabel({})).toBeNull();
    expect(clientLabel({ name: "<>" })).toBeNull();
  });
});
