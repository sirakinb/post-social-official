// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_MIN_LENGTH as WEBSITE_MIN, passwordProblem as websiteProblem } from "../../../src/lib/insforge/auth-rules";
import { ALLOWED, createAuth, PASSWORD_MIN_LENGTH, passwordProblem, SESSION_SECONDS } from "./auth";
import { CODE_MINUTES, composeCodeEmail, resendCodeSender, SIGN_IN_FROM } from "./emails";

describe("our own sign-in", () => {
  it("holds passwords to the rule the website shows people", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(WEBSITE_MIN);
    for (const password of ["short1", "long-but-no-digits", "a-good-password-1", "", "123456789012"]) expect(passwordProblem(password)).toBe(websiteProblem(password));
    expect(passwordProblem(undefined)).toBe("Use at least 12 characters.");
    expect(passwordProblem(123456789012)).toBe("Use at least 12 characters.");
  });

  it("keeps people signed in for 30 days", () => {
    expect(SESSION_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("offers sign up, sign in, sign out, the session, and codes to confirm and reset; nothing else", () => {
    expect([...ALLOWED].sort()).toEqual([
      "GET /get-session",
      "POST /email-otp/request-password-reset",
      "POST /email-otp/reset-password",
      "POST /email-otp/send-verification-otp",
      "POST /email-otp/verify-email",
      "POST /sign-in/email",
      "POST /sign-out",
      "POST /sign-up/email",
    ]);
  });

  it("won't start with a short secret", () => {
    expect(() => createAuth({ pool: {} as never, secret: "too-short", baseUrl: "https://api.postsocial.test", trustedOrigins: [], sendCode: async () => {}, onError: () => {} })).toThrow(/at least 32/);
  });
});

describe("the code emails", () => {
  it("say what the code is for, show it, and say how long it works", () => {
    const confirm = composeCodeEmail("confirm-email", "ada@example.com", "482913");
    expect(confirm).toMatchObject({ to: "ada@example.com", subject: "482913 is your Post Social code", kind: "confirm-email" });
    expect(confirm.text).toContain("482913");
    expect(confirm.text).toContain(`${CODE_MINUTES} minutes`);
    expect(confirm.html).toContain("482913");
    expect(confirm.html).toContain("Confirm your email");

    const reset = composeCodeEmail("reset-password", "ada@example.com", "000042");
    expect(reset.subject).toBe("000042 is your Post Social password reset code");
    expect(reset.text).toContain("Your password stays as it is.");
    // Nothing but digits is ever placed in the page as a code.
    expect(() => composeCodeEmail("confirm-email", "ada@example.com", "<b>1</b>")).toThrow();
  });

  it("go to the person only, from our own address, and never copy anyone", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await resendCodeSender("re_test", fetchImpl as unknown as typeof fetch)(composeCodeEmail("confirm-email", "ada@example.com", "482913"));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(url).toBe("https://api.resend.com/emails");
    expect(sent).toMatchObject({ from: SIGN_IN_FROM, to: ["ada@example.com"] });
    expect(sent.cc).toBeUndefined();
    expect(sent.bcc).toBeUndefined();
    // The code isn't put anywhere Resend indexes or shows in lists besides the message itself.
    expect(JSON.stringify(sent.tags)).not.toContain("482913");
  });

  it("report a refusal without the code or the address", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 422 }));
    const error = await resendCodeSender("re_test", fetchImpl as unknown as typeof fetch)(composeCodeEmail("reset-password", "ada@example.com", "482913")).catch((e: Error) => e);
    expect(String(error)).toContain("422");
    expect(String(error)).not.toMatch(/482913|ada@example\.com/);
  });
});
