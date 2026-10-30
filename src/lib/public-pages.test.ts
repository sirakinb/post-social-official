import { describe, expect, it } from "vitest";
import { markdownPath, publicPath, PUBLIC_PATHS, wantsMarkdown } from "./public-pages";
import { pageMarkdown, tokenEstimate } from "./page-markdown";

describe("wantsMarkdown", () => {
  it("is true when an agent prefers Markdown", () => {
    expect(wantsMarkdown("text/markdown")).toBe(true);
    expect(wantsMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(wantsMarkdown("text/html;q=0.5, text/markdown;q=0.8")).toBe(true);
    expect(wantsMarkdown("text/x-markdown")).toBe(true);
  });

  it("is false for browsers and anyone who ranks HTML higher or turns Markdown off", () => {
    expect(wantsMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(wantsMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(wantsMarkdown("text/markdown;q=0")).toBe(false);
    expect(wantsMarkdown("*/*")).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
  });
});

describe("publicPath", () => {
  it("knows the public pages, with or without a trailing slash, and nothing else", () => {
    expect(PUBLIC_PATHS).toEqual(expect.arrayContaining(["/", "/pricing", "/docs", "/docs/quickstart"]));
    expect(publicPath("/docs/quickstart/")).toBe("/docs/quickstart");
    expect(publicPath("/")).toBe("/");
    expect(publicPath("/beta/accounts")).toBeNull();
    expect(publicPath("/api/v1/posts")).toBeNull();
  });

  it("puts each page's Markdown under /markdown", () => {
    expect(markdownPath("/")).toBe("/markdown");
    expect(markdownPath("/docs/quickstart")).toBe("/markdown/docs/quickstart");
  });
});

describe("pageMarkdown", () => {
  const html = `<html><head><title>Quickstart · Post Social</title><meta name="description" content="Your first post &amp; more."></head>
    <body><header><a href="/">Post Social</a><nav>Menu</nav></header>
    <main><h1>Quickstart</h1><p>Open <a href="/beta/accounts">Accounts</a> and connect.</p><script>alert(1)</script>
    <ul><li>One</li><li>Two</li></ul><pre><code>curl https://www.postsocial.xyz/mcp</code></pre></main>
    <footer>Footer links</footer></body></html>`;

  it("keeps the main content with its title and description, and drops the page chrome and scripts", () => {
    const md = pageMarkdown(html, "/docs/quickstart");
    expect(md.startsWith('---\ntitle: "Quickstart · Post Social"\ndescription: "Your first post & more."\nurl: https://www.postsocial.xyz/docs/quickstart\n---\n')).toBe(true);
    expect(md).toContain("# Quickstart");
    expect(md).toContain("[Accounts](https://www.postsocial.xyz/beta/accounts)");
    expect(md).toContain("- One");
    expect(md).toContain("```");
    expect(md).not.toMatch(/Menu|Footer links|alert\(1\)/);
    expect(tokenEstimate(md)).toBe(Math.ceil(md.length / 4));
  });

  it("brings in a headline that sits above <main>, as on the home page", () => {
    const md = pageMarkdown(`<title>Post Social</title><section><h1>Social media for <span>AI</span> creators.</h1><p>Tell your agent what to post.</p></section><main><h2>How it works</h2></main>`, "/");
    expect(md).toContain("# Social media for AI creators.\n\nTell your agent what to post.\n\n## How it works");
    expect(md).toContain("url: https://www.postsocial.xyz\n");
  });
});
