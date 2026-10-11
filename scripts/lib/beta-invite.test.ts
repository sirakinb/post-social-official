import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { passwordProblem } from "../../src/lib/insforge/auth-rules";
import { BETA_FROM, BETA_REPLY_TO, generatePassword, renderWelcomeEmail, sendWelcomeEmail } from "./beta-invite";

const template = readFileSync(path.resolve(__dirname, "../../emails/closed-beta-welcome.html"), "utf8");
const fields = { firstName: "Jordan", email: "jordan@example.com", password: "abcDEF234ghjk", siteUrl: "https://www.postsocial.xyz/" };

describe("generatePassword", () => {
  it("always passes the sign-in password rules", () => {
    for (let i = 0; i < 200; i++) expect(passwordProblem(generatePassword())).toBeNull();
  });

  it("adds a number when the draw had none", () => {
    // Always picking index 0 draws only "a"s, so a digit has to be put in.
    const password = generatePassword(16, () => 0);
    expect(password).toMatch(/[0-9]/);
    expect(password).toHaveLength(16);
  });

  it("leaves out look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(generatePassword()).not.toMatch(/[0O1lI]/);
  });
});

describe("renderWelcomeEmail", () => {
  it("fills in every field and leaves no placeholders or notes behind", () => {
    const { html, text, subject } = renderWelcomeEmail(template, fields, "prod");
    expect(subject).toBe("You're in. Welcome to the Post Social beta");
    expect(html).toContain("You're in, Jordan.");
    expect(html).toContain("jordan@example.com");
    expect(html).toContain("abcDEF234ghjk");
    expect(html).toContain('href="https://www.postsocial.xyz/beta/login?');
    expect(html).not.toMatch(/\{\{|<!--/);
    expect(text).toContain("Password: abcDEF234ghjk");
    expect(text).toContain("Sign in: https://www.postsocial.xyz/beta/login");
  });

  it("does not tell the tester to change their password", () => {
    const { html, text } = renderWelcomeEmail(template, fields, "prod");
    expect(html.toLowerCase()).not.toContain("change it");
    expect(text.toLowerCase()).not.toContain("change it");
  });

  it("escapes names so they cannot inject markup", () => {
    const { html } = renderWelcomeEmail(template, { ...fields, firstName: '<a href="x">Jo</a>' }, "prod");
    expect(html).toContain("&lt;a href=&quot;x&quot;&gt;Jo&lt;/a&gt;");
    expect(html).not.toContain('<a href="x">');
  });

  it("marks dev emails in the subject", () => {
    expect(renderWelcomeEmail(template, fields, "dev").subject).toBe("[Dev] You're in. Welcome to the Post Social beta");
  });

  it("rejects a template with a field it does not know", () => {
    expect(() => renderWelcomeEmail("<p>{{coupon}}</p>", fields, "prod")).toThrow("{{coupon}}");
  });
});

describe("sendWelcomeEmail", () => {
  const message = { subject: "s", html: "<p>h</p>", text: "t" };

  it("sends from Akinyemi with replies to Aki and an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const result = await sendWelcomeEmail("re_key", "jordan@example.com", message, "beta-welcome:prod:u1", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, id: "email_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("beta-welcome:prod:u1");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: BETA_FROM, to: ["jordan@example.com"], reply_to: [BETA_REPLY_TO] });
  });

  it("reports a refused send instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 }));
    const result = await sendWelcomeEmail("re_key", "jordan@example.com", message, "k", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: "Resend answered 403: Domain not verified" });
  });

  it("reports a network failure instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await sendWelcomeEmail("re_key", "jordan@example.com", message, "k", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: "offline" });
  });
});
