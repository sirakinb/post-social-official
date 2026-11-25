// On AWS a service's settings arrive as one JSON object in SETTINGS_JSON (its Secrets Manager
// secret, e.g. postsocial/dev/api). This spreads them into the environment the code already
// reads. Anything set directly on the container wins, so the addresses AWS itself decides
// (the database host, the API's own address) can't be overridden by a copied setting.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Returns the names it added. Errors name the setting, never its value.
export function applySettingsJson(target: Record<string, string | undefined>): string[] {
  const raw = target.SETTINGS_JSON;
  delete target.SETTINGS_JSON;
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SETTINGS_JSON is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SETTINGS_JSON must be one JSON object of settings.");

  const added: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (!NAME.test(name)) throw new Error("SETTINGS_JSON has a setting name that isn't letters, digits and underscores.");
    if (value === null || value === undefined || target[name] !== undefined) continue;
    // A key pasted as JSON (a JWK, say) rather than as text is still one setting.
    target[name] = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
    added.push(name);
  }
  return added;
}
