import { NodeHtmlMarkdown } from "node-html-markdown";
import { SITE } from "@/lib/api-docs";

// A public page as Markdown for agents: the page's <main> content (no header, footer, menus or
// scripts), with its title and description on top and links made absolute.
const converter = new NodeHtmlMarkdown({ bulletMarker: "-", codeBlockStyle: "fenced", maxConsecutiveNewlines: 2 }, undefined, undefined);

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");

function meta(html: string, name: string) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)="${name}"[^>]*>`, "i"))?.[0];
  return tag ? decode(tag.match(/content="([^"]*)"/i)?.[1] ?? "") : "";
}

export function pageMarkdown(html: string, path: string): string {
  const url = path === "/" ? SITE : `${SITE}${path}`;
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  const description = meta(html, "description");
  let main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  // The home page's headline and opening line sit above <main>, in the hero.
  if (!/<h1\b/i.test(main)) main = (html.match(/<h1\b[\s\S]*?<\/h1>\s*(?:<p\b[\s\S]*?<\/p>)?/i)?.[0] ?? "") + main;
  const content = main
    .replace(/<(script|style|noscript|svg|template|video|iframe|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+aria-hidden="true"[^>]*\/>/gi, "");
  const body = converter
    .translate(content)
    .replace(/\]\(\/(?!\/)/g, `](${SITE}/`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const front = ["---", `title: ${JSON.stringify(title)}`, ...(description ? [`description: ${JSON.stringify(description)}`] : []), `url: ${url}`, "---"].join("\n");
  return `${front}\n\n${body}\n`;
}

// A rough token count (about four characters a token), for the x-markdown-tokens header.
export const tokenEstimate = (text: string) => Math.ceil(text.length / 4);
