import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joinWaitlist } from "./waitlist-action";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("joinWaitlist (server action)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("API_BASE_URL", "https://fn.example/api");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the email to the api function", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(joinWaitlist(null, form({ email: " ada@example.com " }))).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fn.example/api/waitlist");
    expect(JSON.parse(init.body)).toEqual({ email: "ada@example.com", source: "landing" });
  });

  it("passes on the server's explanation", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Enter a valid email address." } }), { status: 400 }));
    await expect(joinWaitlist(null, form({ email: "x" }))).resolves.toEqual({ ok: false, error: "Enter a valid email address." });
  });

  it("quietly ignores bots that fill the hidden field", async () => {
    await expect(joinWaitlist(null, form({ email: "bot@example.com", company: "Spam Inc" }))).resolves.toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for an email when there is none", async () => {
    await expect(joinWaitlist(null, form({}))).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
