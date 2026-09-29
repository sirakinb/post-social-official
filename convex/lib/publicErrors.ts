const SECRET_PATTERN = /(ps_live_|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)[^\s,}]*/gi;

export function publicErrorMessage(error: unknown, fallback = "The request could not be completed.") {
  const raw = error instanceof Error ? error.message : fallback;
  const firstLine = raw.split("\n", 1)[0]
    .replace(/^Uncaught Error:\s*/i, "")
    .replace(/\s+at (?:handler|async handler).*$/i, "")
    .trim();
  if (!firstLine) return fallback;
  return firstLine.replace(SECRET_PATTERN, "$1[hidden]").slice(0, 300);
}
