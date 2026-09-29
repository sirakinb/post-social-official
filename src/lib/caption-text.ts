export type CaptionToken = { type: "text" | "hashtag" | "mention"; value: string };

/** Splits a caption so hashtags and @mentions can be styled the way the apps do. */
export function tokenizeCaption(text: string): CaptionToken[] {
  const tokens: CaptionToken[] = [];
  const pattern = /(#[\p{L}\p{N}_]+|@[\w.]+)/gu;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: "text", value: text.slice(last, index) });
    tokens.push({ type: match[0].startsWith("#") ? "hashtag" : "mention", value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

/** Shortens a caption at a word boundary, the way a feed shows "… more". */
export function truncateCaption(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  const base = boundary > max * 0.6 ? cut.slice(0, boundary) : cut;
  return { text: `${base.trimEnd()}…`, truncated: true };
}
