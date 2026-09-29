export function friendlyErrorMessage(error: unknown, fallback: string): string {
  let text: string | undefined;

  if (typeof error === "string") {
    text = error;
  } else if (error instanceof Error) {
    text = error.message;
  }

  if (!text || text.trim().length === 0) return fallback;

  text = text.replace(/^Uncaught Error:\s*/i, "");
  text = text.split(/\r?\n/)[0] ?? "";
  text = text.replace(/\s+at\s+handler\b.*$/i, "");
  text = text.replace(/\bps_live_[a-zA-Z0-9_]+\b/g, "[redacted]");
  text = text.replace(
    /\b(access_token|refresh_token|client_secret)\s*[:=]\s*["']?[a-zA-Z0-9_\-.]+["']?/gi,
    "$1=[redacted]",
  );
  text = text.trim();

  if (text.length > 300) text = `${text.slice(0, 300).trimEnd()}…`;
  return text.length > 0 && text !== "[redacted]" ? text : fallback;
}
