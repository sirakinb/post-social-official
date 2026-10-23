import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";

// next/script adds its tag in the browser, so show it as a plain tag to see what it was given.
vi.mock("next/script", () => ({ default: (props: Record<string, string>) => createElement("script", props) }));
vi.mock("./fonts", () => ({ GeistSans: { variable: "font-sans" }, GeistMono: { variable: "font-mono" } }));

afterEach(() => vi.unstubAllEnvs());

describe("RootLayout analytics", () => {
  it("loads DataFast on the live site", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    const html = renderToStaticMarkup(<RootLayout>x</RootLayout>);
    expect(html).toContain("https://datafa.st/js/script.js");
    expect(html).toContain('data-website-id="dfid_ev0xid7Q3dcHOMtmozFCa"');
    expect(html).toContain('data-domain="postsocial.xyz"');
  });

  it("does not load it on previews or staging", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "preview");
    expect(renderToStaticMarkup(<RootLayout>x</RootLayout>)).not.toContain("datafa.st");
  });
});
