// Which automation answers a comment. Shared by the worker and the tests, so the rules the
// web app describes are the rules that run.

export type MatchMode = "word" | "contains" | "exact";

export type AutomationRule = {
  id: string;
  platform_post_id: string | null;
  keywords: string[];
  match_mode: MatchMode;
  exclude_keywords: string[];
  created_at: string;
};

// Lower case, accents and emoji kept, curly quotes and extra spaces flattened, so "GUIDE",
// " guide " and "Guide!" compare the same.
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// word: the keyword as a whole word or phrase ("guide" fires on "send the guide!" but not
// "guidebook"); contains: anywhere, even inside a word; exact: the whole comment.
export function keywordMatches(comment: string, keyword: string, mode: MatchMode) {
  const text = normalize(comment);
  const word = normalize(keyword);
  if (!word) return false;
  if (mode === "exact") return text.replace(/[^\p{L}\p{N}\s']/gu, "").trim() === word.replace(/[^\p{L}\p{N}\s']/gu, "").trim();
  if (mode === "contains") return text.includes(word);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

// An automation answers a comment when the post fits (its own post, or every post), a
// keyword matches (no keywords: any comment) and no excluded word appears.
export function automationMatches(rule: AutomationRule, comment: { text: string; postId: string | null }) {
  if (rule.platform_post_id && rule.platform_post_id !== comment.postId) return false;
  const text = comment.text ?? "";
  if (rule.exclude_keywords.some((k) => keywordMatches(text, k, rule.match_mode))) return false;
  if (!rule.keywords.length) return true;
  return rule.keywords.some((k) => keywordMatches(text, k, rule.match_mode));
}

// One comment gets one automation: one set up for that post wins over an every-post one,
// then the newest.
export function pickAutomation<T extends AutomationRule>(rules: T[], comment: { text: string; postId: string | null }): T | null {
  const matching = rules.filter((r) => automationMatches(r, comment));
  matching.sort((a, b) => Number(Boolean(b.platform_post_id)) - Number(Boolean(a.platform_post_id)) || b.created_at.localeCompare(a.created_at));
  return matching[0] ?? null;
}

// One of the message and its variations, picked at random so repeat DMs aren't identical.
export function pickVariation(main: string, variations: string[], random: () => number = Math.random) {
  const options = [main, ...variations.filter((v) => v.trim())];
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

// {username} in a message becomes the commenter's handle.
export function personalize(text: string, username: string | null) {
  return text.replace(/\{username\}/g, username ? `@${username}` : "there");
}
