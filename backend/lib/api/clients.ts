// The AI app behind an MCP connection, from the name it gives when it connects
// (initialize's clientInfo). Known apps get the name people know them by; anything else
// keeps its own title or name, cleaned up.
const KNOWN: Array<[RegExp, string]> = [
  [/^claude[-_ ]?code/i, "Claude Code"],
  [/claude|anthropic/i, "Claude"],
  [/muse|meta[-_ ]?ai/i, "Muse"],
  [/^grok|\bxai\b/i, "Grok"],
  [/hermes/i, "Hermes"],
  [/openclaw/i, "OpenClaw"],
  [/codex/i, "Codex"],
  [/chatgpt|^openai/i, "ChatGPT"],
  [/cursor/i, "Cursor"],
  [/windsurf|codeium/i, "Windsurf"],
  [/gemini/i, "Gemini CLI"],
  [/copilot|visual studio code|^vscode/i, "GitHub Copilot"],
  [/perplexity/i, "Perplexity"],
];

export function clientLabel(info: unknown): string | null {
  if (!info || typeof info !== "object") return null;
  const { name, title } = info as { name?: unknown; title?: unknown };
  const given = [name, title].filter((v): v is string => typeof v === "string").map((v) => v.trim());
  for (const [pattern, label] of KNOWN) if (given.some((v) => pattern.test(v))) return label;
  // Printable text only, short enough for a log row.
  const own = (typeof title === "string" && title.trim() ? title : typeof name === "string" ? name : "").replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 80);
  return own || null;
}
