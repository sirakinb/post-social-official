// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "u1", email: "ada@example.com", profile: { name: "Ada" } } as { id: string; email: string; profile?: { name?: string } } | null, insforgeReads: 0 }));
vi.mock("@/lib/insforge/server", () => ({
  currentUser: async () => state.user,
  insforgeServerClient: async () => ({
    database: {
      from: () => {
        state.insforgeReads += 1;
        return { select: () => ({ eq: async () => ({ data: [{ role: "owner", workspace_id: "w-insforge", workspaces: { name: "From InsForge", slug: "from-insforge" } }] }) }) };
      },
    },
  }),
}));
vi.mock("@/lib/sign-in/session", () => ({ sessionToken: async () => "person-token", signedOutPath: async (next: string) => `/beta/login?next=${encodeURIComponent(next)}` }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));

import { loadGetStarted } from "./get-started";
import { loadFrame, loadViewer } from "./workspace";

const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
let answers: Record<string, unknown> = {};

beforeEach(() => {
  calls.length = 0;
  state.insforgeReads = 0;
  state.user = { id: "u1", email: "ada@example.com", profile: { name: "Ada" } };
  vi.stubEnv("API_BASE_URL", "https://api.postsocial.test/api");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
    const answer = answers[body.action as string];
    return answer === undefined ? new Response(JSON.stringify({ error: { message: "Unknown action." } }), { status: 400 }) : new Response(JSON.stringify(answer), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("every page's start: the person and their workspace", () => {
  it("reads the workspaces from the database with the person's InsForge session, as it always has", async () => {
    const { viewer, workspace } = await loadViewer("/beta");
    expect(viewer).toMatchObject({ id: "u1", name: "Ada" });
    expect(workspace).toEqual({ id: "w-insforge", name: "From InsForge", slug: "from-insforge", role: "owner" });
    expect(calls).toHaveLength(0);
  });

  it("asks our API instead when the pages are set to read through it", async () => {
    vi.stubEnv("PAGE_READS", "api");
    answers = { my_workspaces: { workspaces: [{ id: "w1", name: "Pentridge", slug: "pentridge", role: "owner" }, { id: "w2", name: "Second", slug: "second", role: "reviewer" }] } };
    const { workspace, workspaces } = await loadViewer("/beta/calendar", "second");
    expect(workspace).toEqual({ id: "w2", name: "Second", slug: "second", role: "reviewer" });
    expect(workspaces).toHaveLength(2);
    expect(calls[0]).toEqual({ url: "https://api.postsocial.test/api/keys", auth: "Bearer person-token", body: { action: "my_workspaces" } });
    expect(state.insforgeReads).toBe(0);
  });

  it("creates a first workspace for someone who has none, then reads again", async () => {
    vi.stubEnv("PAGE_READS", "api");
    answers = { my_workspaces: { workspaces: [] }, provision_workspace: { workspace_id: "w-new" } };
    await loadViewer("/beta");
    expect(calls.map((call) => call.body.action)).toEqual(["my_workspaces", "provision_workspace", "my_workspaces"]);
  });

  it("sends a signed-out visitor to sign in, to come back to the page", async () => {
    state.user = null;
    await expect(loadViewer("/beta/calendar")).rejects.toThrow("REDIRECT /beta/login?next=%2Fbeta%2Fcalendar");
  });
});

describe("the app frame through our API", () => {
  it("gives the getting-started steps from one read", async () => {
    vi.stubEnv("PAGE_READS", "api");
    answers = { app_frame: { plan: { name: "Free", max_posts_per_month: 30 }, posts_published: 4, steps: { account: true, ai: false, post: false } } };
    expect(await loadGetStarted({} as never, "w1")).toEqual({ account: true, ai: false, post: false });
    expect(calls[0].body).toEqual({ action: "app_frame", workspace_id: "w1" });
    expect((await loadFrame("w1"))?.posts_published).toBe(4);
  });

  it("shows no steps done, rather than failing the page, when the read doesn't come back", async () => {
    vi.stubEnv("PAGE_READS", "api");
    answers = {};
    expect(await loadGetStarted({} as never, "w1")).toEqual({ account: false, ai: false, post: false });
  });
});
