import { describe, expect, it } from "vitest";
import type { AgentCaller, Sql } from "../access";
import { publicHandle } from "../connections/handles";
import { getPost, validatePost } from "../publishing/service";
import { openApiDocument } from "./openapi";
import { listPosts, listResults } from "./reads";

// Two accounts with the same profile name: only the platform and @handle tell them apart.
const WS = "00000000-0000-4000-8000-000000000002";
const IG = "00000000-0000-4000-8000-0000000000a1";
const LI = "00000000-0000-4000-8000-0000000000a2";
const POST = "00000000-0000-4000-8000-0000000000b1";
const caller: AgentCaller = {
  kind: "key",
  credentialId: "00000000-0000-4000-8000-000000000001",
  workspaceId: WS,
  actorId: "00000000-0000-4000-8000-000000000003",
  mode: "live",
  displayName: "Claude Code",
  entryPoint: "mcp",
};
const accounts = [
  { id: IG, platform: "instagram", display_name: "Emmanuel Jones", handle: "secondshootapp" },
  { id: LI, platform: "linkedin", display_name: "Emmanuel Jones", handle: "Emmanuel Jones" },
];

// Answers each query by what it reads.
function fakeSql(): Sql {
  return (async (query: string) => {
    if (query.includes("FROM public.posts p")) {
      return [{
        id: POST, status: "published",
        destinations: accounts.map((a) => ({ id: `d-${a.platform}`, account_id: a.id, account: a.display_name, account_handle: a.handle, platform: a.platform, status: "published" })),
      }];
    }
    if (query.includes("SELECT d.post_id, d.id AS destination_id")) {
      return accounts.map((a) => ({ post_id: POST, destination_id: `d-${a.platform}`, platform: a.platform, account: a.display_name, account_handle: a.handle, status: "published" }));
    }
    if (query.includes("SELECT * FROM public.posts WHERE id")) {
      return [{ id: POST, workspace_id: WS, status: "draft", caption: "Hello", scheduled_at: null, entry_point: "mcp", actor_id: null, created_at: "", updated_at: "" }];
    }
    if (query.includes("SELECT d.id, d.connected_account_id AS account_id")) {
      return accounts.map((a) => ({ id: `d-${a.platform}`, account_id: a.id, account: a.display_name, account_handle: a.handle, platform: a.platform, status: "draft", options: {} }));
    }
    if (query.includes("FROM public.destinations WHERE post_id")) {
      return accounts.map((a) => ({ id: `d-${a.platform}`, connected_account_id: a.id, platform: a.platform, status: "draft", options: {} }));
    }
    if (query.includes("FROM public.connected_accounts a JOIN public.workspaces")) {
      return accounts.map((a) => ({ ...a, health: "connected", capabilities: {}, policy: "autonomous", tiktok_delivery: "direct" }));
    }
    return [];
  }) as unknown as Sql;
}

const named = (list: Array<Record<string, unknown>>) => list.map((d) => ({ account: d.account, platform: d.platform, account_handle: d.account_handle }));
const expected = [
  { account: "Emmanuel Jones", platform: "instagram", account_handle: "secondshootapp" },
  // LinkedIn shares no public handle with Post Social, so there is none to give.
  { account: "Emmanuel Jones", platform: "linkedin", account_handle: null },
];

describe("account handles in API results", () => {
  it("gives a real handle, without the @, and null where the platform has none", () => {
    expect(publicHandle("instagram", "secondshootapp")).toBe("secondshootapp");
    expect(publicHandle("x", "@someone")).toBe("someone");
    expect(publicHandle("bluesky", "name.bsky.social")).toBe("name.bsky.social");
    expect(publicHandle("linkedin", "Emmanuel Jones")).toBeNull();
    expect(publicHandle("facebook", "My Page")).toBeNull();
    expect(publicHandle("youtube", "youtube")).toBeNull();
    // A placeholder saved when the platform returned no username.
    expect(publicHandle("tiktok", "tiktok")).toBeNull();
    expect(publicHandle("threads", "")).toBeNull();
    expect(publicHandle("instagram", null)).toBeNull();
  });

  it("names each account's platform and handle in post lists", async () => {
    const { posts } = await listPosts(fakeSql(), caller, { workspace_id: WS });
    expect(named((posts[0] as { destinations: Array<Record<string, unknown>> }).destinations)).toEqual(expected);
  });

  it("names each account's platform and handle in results", async () => {
    const { results } = await listResults(fakeSql(), caller, { workspace_id: WS });
    expect(named(results)).toEqual(expected);
  });

  it("names each account's platform and handle in a single post", async () => {
    const post = await getPost({ sql: fakeSql() }, caller, { post_id: POST });
    expect(named(post.destinations)).toEqual(expected);
  });

  it("names each account's platform and handle in check results", async () => {
    const result = await validatePost({ sql: fakeSql() }, caller, { post_id: POST });
    expect(named(result.destinations)).toEqual(expected);
  });

  it("documents account_handle, and LinkedIn's missing handle, for each call that names accounts", () => {
    const ops = Object.values(openApiDocument("https://api.example").paths).flatMap((p) => Object.values(p)) as Array<{ operationId: string; description: string }>;
    for (const name of ["list_posts", "get_post", "list_post_results", "validate_post"]) {
      const op = ops.find((o) => o.operationId === name);
      expect(op?.description, name).toMatch(/account_handle.*null for LinkedIn/);
    }
  });
});
