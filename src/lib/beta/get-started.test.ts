import { describe, expect, it } from "vitest";
import { loadGetStarted, stepsDone } from "./get-started";

// A stand-in for the database client: each table answers with the rows given (or fails).
function client(rows: Record<string, unknown[] | "error">, seen: string[] = []) {
  return {
    database: {
      from(table: string) {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          not: (column: string) => { seen.push(`${table} not ${column}`); return q; },
          in: (_c: string, values: string[]) => { seen.push(`${table} in ${values.join(",")}`); return q; },
          limit: () => (rows[table] === "error" ? Promise.reject(new Error("down")) : Promise.resolve({ data: (rows[table] as unknown[]) ?? [] })),
        };
        return q;
      },
    },
  };
}

describe("loadGetStarted", () => {
  it("is all to do for a new workspace", async () => {
    const steps = await loadGetStarted(client({}) as never, "w1");
    expect(steps).toEqual({ account: false, ai: false, post: false });
    expect(stepsDone(steps)).toBe(0);
  });

  it("counts an AI app sign-in or a used API key as connecting an AI", async () => {
    expect((await loadGetStarted(client({ oauth_grants: [{ id: "g" }] }) as never, "w1")).ai).toBe(true);
    const seen: string[] = [];
    expect((await loadGetStarted(client({ api_keys: [{ id: "k" }] }, seen) as never, "w1")).ai).toBe(true);
    expect(seen).toContain("api_keys not last_used_at");
  });

  it("counts a post as sent once it is scheduled or on its way, not while it is a draft", async () => {
    const seen: string[] = [];
    const steps = await loadGetStarted(client({ connected_accounts: [{ id: "a" }], posts: [{ id: "p" }] }, seen) as never, "w1");
    expect(steps).toEqual({ account: true, ai: false, post: true });
    const posts = seen.find((x) => x.startsWith("posts in"))!;
    expect(posts).toContain("scheduled");
    expect(posts).toContain("published");
    expect(posts).not.toContain("draft");
  });

  it("treats a table it can't read as not done, instead of failing the page", async () => {
    expect(await loadGetStarted(client({ connected_accounts: "error" }) as never, "w1")).toEqual({ account: false, ai: false, post: false });
  });
});
