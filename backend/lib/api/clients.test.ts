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

  it("names agent apps by the names they actually send", () => {
    // Seen in production: Claude's sign-in and Muse's own connector.
    expect(clientLabel({ name: "AnthropicClaudeAI" })).toBe("Claude");
    expect(clientLabel({ name: "muse-custom-connector" })).toBe("Muse");
    expect(clientLabel({ name: "Muse" })).toBe("Muse");
    expect(clientLabel({ name: "meta-ai" })).toBe("Muse");
    expect(clientLabel({ name: "grok-cli" })).toBe("Grok");
    expect(clientLabel({ name: "xai mcp" })).toBe("Grok");
    expect(clientLabel({ name: "hermes-agent" })).toBe("Hermes");
    expect(clientLabel({ name: "openclaw" })).toBe("OpenClaw");
    // Claude Code still wins over plain Claude.
    expect(clientLabel({ name: "claude-code" })).toBe("Claude Code");
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
