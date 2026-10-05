import { describe, expect, it, vi } from "vitest";
import type { Sql } from "./access";
import { clientIp, enforceLimit, fromOurWebsite, hashId, LIMITS, networkOf, RateLimitError, takeLimit } from "./rate-limit";
import { setErrorReporter } from "./telemetry";

const req = (headers: Record<string, string>) => new Request("https://fn/x", { headers });

describe("clientIp", () => {
  it("trusts only the address the gateway appended, never what the caller put first", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 98.115.239.218" }))).toBe("98.115.239.218");
    expect(clientIp(req({ "x-forwarded-for": "98.115.239.218" }))).toBe("98.115.239.218");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("believes our website's forwarded visitor address only with the shared secret", () => {
    const forwarded = { "x-forwarded-for": "76.76.21.21", "x-ps-client-ip": "203.0.113.9" };
    expect(clientIp(req({ ...forwarded, "x-ps-proxy-secret": "s3cret-value" }), "s3cret-value")).toBe("203.0.113.9");
    expect(clientIp(req({ ...forwarded, "x-ps-proxy-secret": "guess" }), "s3cret-value")).toBe("76.76.21.21");
    expect(clientIp(req(forwarded), "s3cret-value")).toBe("76.76.21.21");
    expect(clientIp(req({ ...forwarded, "x-ps-proxy-secret": "anything" }), null)).toBe("76.76.21.21");
    expect(fromOurWebsite(req({ "x-ps-proxy-secret": "s3cret-value" }), "s3cret-value")).toBe(true);
  });
});

describe("networkOf", () => {
  it("groups IPv6 by /64 and leaves IPv4 alone", () => {
    expect(networkOf("98.115.239.218")).toBe("98.115.239.218");
    expect(networkOf("::ffff:98.115.239.218")).toBe("98.115.239.218");
    expect(networkOf("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(networkOf("2001:db8:abcd:12::9")).toBe("2001:db8:abcd:12::/64");
    expect(networkOf("2001:DB8:ABCD:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("treats two addresses in one IPv6 network as the same visitor", () => {
    expect(clientIp(req({ "x-forwarded-for": "2001:db8:abcd:12::1" }))).toBe(clientIp(req({ "x-forwarded-for": "2001:db8:abcd:12:ffff:ffff:ffff:ffff" })));
  });
});

describe("hashId", () => {
  it("with a secret, can't be matched by hashing guesses", async () => {
    const keyed = await hashId("98.115.239.218", "server-secret");
    expect(keyed).not.toBe(await hashId("98.115.239.218"));
    expect(keyed).not.toBe(await hashId("98.115.239.218", "other-secret"));
    expect(keyed).toBe(await hashId("98.115.239.218", "server-secret"));
  });

  it("is stable, short, and ignores case and spaces", async () => {
    const a = await hashId(" Ada@Example.com ");
    expect(a).toBe(await hashId("ada@example.com"));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("ada");
  });
});

describe("takeLimit / enforceLimit", () => {
  const sqlReturning = (wait: number) => vi.fn(async () => [{ wait }]) as unknown as Sql;

  it("passes the key, limit and window to the database", async () => {
    const sql = sqlReturning(0);
    expect(await takeLimit(sql, "waitlist_ip", "abc")).toBe(0);
    expect((sql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(["waitlist_ip:abc", LIMITS.waitlist_ip.limit, LIMITS.waitlist_ip.windowSeconds]);
  });

  it("throws a 429 with the wait when over", async () => {
    await expect(enforceLimit(sqlReturning(42), "api_credential", "k")).rejects.toMatchObject({ status: 429, retryAfter: 42 });
    await expect(enforceLimit(sqlReturning(42), "api_credential", "k")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("lets the request through when the counter can't be reached, and reports it", async () => {
    const report = { captureException: vi.fn(async () => undefined), capture: vi.fn(async () => undefined) };
    setErrorReporter(report);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = vi.fn(async () => {
      throw new Error("database down");
    }) as unknown as Sql;
    expect(await takeLimit(broken, "signin_ip", "x")).toBe(0);
    expect(report.captureException).toHaveBeenCalled();
    setErrorReporter(null);
    vi.restoreAllMocks();
  });
});
