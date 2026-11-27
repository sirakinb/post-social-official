// @vitest-environment node
//
// The backend on a plain Postgres 15, set up the way the AWS database is. Runs against the
// local database from scripts/local-database.sh: `npm run test:pg`. Skipped by `npm test`.
// It proves the three things the move to AWS rests on: our migrations build the schema
// without InsForge, queries return exactly what InsForge returned, and the access policies
// hold when the API runs a query for a signed-in person.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Caller } from "../lib/access";
import { createKey } from "../lib/api/keys";
import { accountsPage, activityPage, apiPage, appFrame, calendarPage, composerPage, draftsPage, inboxAccountsList, mediaByIds, mediaPage, myWorkspaces } from "../lib/api/pages";
import { addXUsageToInvoice, handleStripeEvent, recordSubscription, type Stripe } from "../lib/billing";
import { assertUtc, DatabaseError, poolConfig, poolSql, userSql } from "../lib/database";
import { X_PRICES } from "../lib/pricing";
import { scramVerifier, setPasswordStatement } from "../lib/scram";
import { provisionWorkspace } from "../lib/signup";
import { recordWorkerBeat, secondsSinceWorkerBeat } from "../lib/worker-heartbeat";
import { createService } from "../service";

const enabled = process.env.POSTSOCIAL_PG_TESTS === "1";
const port = process.env.LOCAL_DB_PORT ?? "55432";
const adminUrl = process.env.DATABASE_URL ?? `postgres://app_admin:local@127.0.0.1:${port}/postsocial`;
const userUrl = process.env.DATABASE_USER_URL ?? `postgres://app_user:local@127.0.0.1:${port}/postsocial`;
const ownerUrl = process.env.DATABASE_OWNER_URL ?? `postgres://postsocial_admin:local@127.0.0.1:${port}/postsocial`;

describe.skipIf(!enabled)("the backend on plain Postgres", () => {
  const adminPool = new pg.Pool(poolConfig({ url: adminUrl, max: 4 }));
  // One connection, so every signed-in query below reuses it: a leak between people would show.
  const userPool = new pg.Pool(poolConfig({ url: userUrl, max: 1 }));
  const sql = poolSql(adminPool);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const people: Record<"ada" | "ben", { id: string; workspaceId: string }> = { ada: { id: "", workspaceId: "" }, ben: { id: "", workspaceId: "" } };

  beforeAll(async () => {
    assertUtc();
    for (const name of ["ada", "ben"] as const) {
      const [user] = await sql<{ id: string }>(`INSERT INTO auth.users (email, email_verified, profile) VALUES ($1, true, $2) RETURNING id`, [`pg-${name}-${suffix}@postsocial.test`, { name }]);
      const caller: Caller = { userId: user.id, displayName: `${name} ${suffix}`, entryPoint: "ui" };
      const { workspace_id } = await provisionWorkspace(sql, caller);
      people[name] = { id: user.id, workspaceId: workspace_id };
    }
  }, 60_000);

  afterAll(async () => {
    const workspaces = Object.values(people).map((p) => p.workspaceId).filter(Boolean);
    const users = Object.values(people).map((p) => p.id).filter(Boolean);
    if (workspaces.length) await sql(`DELETE FROM public.workspaces WHERE id = ANY($1::uuid[])`, [workspaces]);
    if (users.length) await sql(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [users]);
    await adminPool.end();
    await userPool.end();
  }, 60_000);

  it("returns every column type exactly as InsForge's SQL endpoint did", async () => {
    const [row] = await sql(
      `select '2026-01-02 03:04:05.123456+00'::timestamptz as ts, date '2026-03-04' as d, 9007199254740993::int8 as big, 1.50::numeric as num,
              2::int4 as i, 1.5::float8 as f, '{"a":1}'::jsonb as j, array[1,2] as arr, array['a','b']::text[] as tarr,
              array['2026-01-02 03:04:05+00'::timestamptz] as tsarr, interval '1 day 2 hours' as iv, '\\x01ff'::bytea as b, null as n, true as t,
              '00000000-0000-0000-0000-000000000001'::uuid as u, '12:30'::time as tm, timestamp '2026-01-02 03:04:05' as tsnotz, count(*) as c,
              'x'::char(3) as ch, int4range(1,5) as rng, 3::int2 as small, 1.5::real as r4, '{}'::json as js from (select 1) x`,
      [],
    );
    // Captured from the InsForge dev backend on 2026-11-25 with this same query.
    expect(row).toEqual({
      ts: "2026-01-02T03:04:05.123Z", d: "2026-03-04T00:00:00.000Z", big: "9007199254740993", num: "1.50", i: 2, f: 1.5, j: { a: 1 }, arr: [1, 2], tarr: ["a", "b"],
      tsarr: ["2026-01-02T03:04:05.000Z"], iv: { days: 1, hours: 2 }, b: { type: "Buffer", data: [1, 255] }, n: null, t: true,
      u: "00000000-0000-0000-0000-000000000001", tm: "12:30:00", tsnotz: "2026-01-02T03:04:05.000Z", c: "1", ch: "x  ", rng: "[1,5)", small: 3, r4: 1.5, js: {},
    });
  });

  it("takes parameters the way callers already pass them", async () => {
    const [row] = await sql<{ at: string; ids: string[]; meta: { a: number }; missing: null }>(
      `select $1::timestamptz as at, $2::uuid[] as ids, $3::jsonb as meta, $4::text as missing`,
      [new Date("2026-05-06T07:08:09.000Z"), [people.ada.id], { a: 1 }, undefined],
    );
    expect(row).toEqual({ at: "2026-05-06T07:08:09.000Z", ids: [people.ada.id], meta: { a: 1 }, missing: null });
  });

  it("has the schema our migrations describe, owned by project_admin, with every table protected", async () => {
    const [shape] = await sql<{ tables: string; unprotected: string; other_owners: string; policies: string; functions: string; me: string }>(
      `select (select count(*) from pg_tables where schemaname = 'public') as tables,
              (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity) as unprotected,
              (select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'project_admin') as other_owners,
              (select count(*) from pg_policies where schemaname = 'public') as policies,
              (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions,
              current_user as me`,
      [],
    );
    expect(shape.me).toBe("project_admin");
    expect(Number(shape.tables)).toBeGreaterThanOrEqual(56);
    expect(Number(shape.policies)).toBeGreaterThanOrEqual(27);
    expect(Number(shape.functions)).toBeGreaterThanOrEqual(30);
    expect([shape.unprotected, shape.other_owners]).toEqual(["0", "0"]);
  });

  it("keeps Postgres's error code, e.g. for a duplicate", async () => {
    const error = await sql(`INSERT INTO auth.users (email) VALUES ($1)`, [`pg-ada-${suffix}@postsocial.test`]).catch((e) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/duplicate key/);
  });

  describe("queries for a signed-in person", () => {
    it("show each person their own workspace and posts, and nobody else's", async () => {
      // Ada, then Ben, then Ada again, all on the same connection.
      for (const name of ["ada", "ben", "ada"] as const) {
        const mine = userSql(userPool, people[name].id);
        const other = people[name === "ada" ? "ben" : "ada"];
        expect(await mine<{ id: string }>(`select id from public.workspaces`, [])).toEqual([{ id: people[name].workspaceId }]);
        const posts = await mine<{ workspace_id: string }>(`select workspace_id from public.posts`, []);
        expect(posts.length).toBeGreaterThan(0); // the sample draft
        expect(posts.every((post) => post.workspace_id === people[name].workspaceId)).toBe(true);
        expect(await mine(`select id from public.workspaces where id = $1`, [other.workspaceId])).toEqual([]);
        expect(await mine(`select id from public.posts where workspace_id = $1`, [other.workspaceId])).toEqual([]);
        const [who] = await mine<{ uid: string; me: string }>(`select auth.uid() as uid, current_user as me`, []);
        expect(who).toEqual({ uid: people[name].id, me: "authenticated" });
      }
    });

    it("can't reach tables that are for the service only, or change what they can read", async () => {
      const mine = userSql(userPool, people.ada.id);
      for (const table of ["public.waitlist", "public.rate_limits", "public.workspace_billing", "public.worker_heartbeat", "public.oauth_access_tokens", "auth.users"]) {
        await expect(mine(`select * from ${table} limit 1`, []), table).rejects.toThrow(/permission denied/);
      }
      await expect(mine(`delete from public.posts where workspace_id = $1 returning id`, [people.ada.workspaceId])).rejects.toThrow(/permission denied/);
    });

    it("leave no identity behind on the connection, and can't step up to the service's role", async () => {
      const client = await userPool.connect();
      try {
        const { rows } = await client.query(`select auth.uid() as uid, current_user as me, (select count(*) from public.workspaces) as visible`);
        expect(rows[0]).toEqual({ uid: null, me: "authenticated", visible: "0" });
        await expect(client.query(`SET ROLE project_admin`)).rejects.toThrow(/permission denied/);
        await expect(client.query(`SET ROLE app_admin`)).rejects.toThrow(/permission denied/);
      } finally {
        client.release();
      }
    });
  });

  describe("what the web app's pages read through the API", () => {
    const ada = (): Caller => ({ userId: people.ada.id, displayName: `ada ${suffix}`, entryPoint: "ui" });
    const ben = (): Caller => ({ userId: people.ben.id, displayName: `ben ${suffix}`, entryPoint: "ui" });

    it("lists a person's own workspaces and nobody else's", async () => {
      const mine = await myWorkspaces(sql, ada());
      expect(mine.workspaces).toHaveLength(1);
      expect(mine.workspaces[0]).toMatchObject({ id: people.ada.workspaceId, role: "owner" });
      expect(typeof mine.workspaces[0].slug).toBe("string");
      expect((await myWorkspaces(sql, ben())).workspaces.map((w) => w.id)).toEqual([people.ben.workspaceId]);
    });

    it("gives the app frame from real rows, the same numbers the database's own usage function gives", async () => {
      const before = await appFrame(sql, ada(), { workspace_id: people.ada.workspaceId });
      expect(before.plan).toMatchObject({ name: expect.any(String), max_posts_per_month: expect.any(Number) });
      expect(before).toMatchObject({ posts_published: 0, steps: { account: false, ai: false, post: false } });

      await sql(`INSERT INTO public.usage_events (workspace_id, event_type, quantity) VALUES ($1, 'post_published', 2), ($1, 'post_published', 3), ($1, 'api_call', 9)`, [people.ada.workspaceId]);
      // Last month's don't count.
      await sql(`INSERT INTO public.usage_events (workspace_id, event_type, quantity, occurred_at) VALUES ($1, 'post_published', 50, date_trunc('month', now()) - interval '1 day')`, [people.ada.workspaceId]);
      const after = await appFrame(sql, ada(), { workspace_id: people.ada.workspaceId });
      expect(after.posts_published).toBe(5);
      const [fromFunction] = await sql<{ quantity: string }>(`SELECT quantity FROM public.workspace_usage($1) WHERE event_type = 'post_published'`, [people.ada.workspaceId]);
      expect(Number(fromFunction.quantity)).toBe(after.posts_published);
      // What the person's own session read before, through the access policies: the same plan.
      const [viaPolicies] = await userSql(userPool, people.ada.id)<{ name: string; max_posts_per_month: number }>(`SELECT p.name, p.max_posts_per_month FROM public.workspace_plans wp JOIN public.plans p ON p.id = wp.plan_id WHERE wp.workspace_id = $1`, [people.ada.workspaceId]);
      expect(after.plan).toEqual(viaPolicies);
    });

    it("won't show one person another's workspace", async () => {
      await expect(appFrame(sql, ben(), { workspace_id: people.ada.workspaceId })).rejects.toMatchObject({ status: 404 });
    });

    it("gives the accounts page, the composer and the inbox what they show, from real rows", async () => {
      const ws = people.ada.workspaceId;
      const one = async <T = { id: string }>(query: string, params: unknown[]) => (await sql<T>(query, params))[0];
      const account = (platform: string, name: string, extra = "") =>
        one(`INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities${extra ? ", health" : ""}) VALUES ($1, $2, $3, $3, $4, '{"post_types":["image"],"caption_max_chars":2200}'${extra ? `, '${extra}'` : ""}) RETURNING id`, [ws, platform, `${platform}-${name}-${suffix}`, name]);
      const instagram = await account("instagram", "Zed Insta");
      const tiktok = await account("tiktok", "Able Tok");
      const gone = await account("threads", "Gone Threads", "disconnected");
      const profile = await one(`INSERT INTO public.profiles (workspace_id, name) VALUES ($1, 'Brand') RETURNING id`, [ws]);
      await sql(`UPDATE public.connected_accounts SET profile_id = $2 WHERE id = $1`, [instagram.id, profile.id]);
      const media = (name: string, status = "ready") =>
        one(`INSERT INTO public.media_assets (workspace_id, storage_key, file_name, mime_type, media_type, size_bytes, width, height, status) VALUES ($1, $2, $3, 'image/png', 'image', 1000, 1080, 1080, $4) RETURNING id`, [ws, `${ws}/${suffix}/${name}`, name, status]);
      const ready = await media("ready.png");
      const pending = await media("pending.png", "processing");
      const post = await one(`INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy, status) VALUES ($1, 'ui', 'Hello', 'autonomous', 'draft') RETURNING id`, [ws]);
      await sql(`INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, effective_approval_policy) VALUES ($1, $2, $3, 'instagram', 'autonomous')`, [ws, post.id, instagram.id]);
      await sql(`INSERT INTO public.post_media (post_id, media_asset_id, workspace_id, position) VALUES ($1, $2, $3, 0)`, [post.id, ready.id, ws]);
      // Something of Ben's that must never appear.
      const bens = await one(`INSERT INTO public.media_assets (workspace_id, storage_key, file_name, mime_type, media_type, size_bytes, width, height, status) VALUES ($1, $2, 'bens.png', 'image/png', 'image', 1000, 10, 10, 'ready') RETURNING id`, [people.ben.workspaceId, `${people.ben.workspaceId}/${suffix}/bens.png`]);
      const bensPost = await one(`INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy, status) VALUES ($1, 'ui', 'Bens', 'autonomous', 'draft') RETURNING id`, [people.ben.workspaceId]);

      const accounts = await accountsPage(sql, ada(), { workspace_id: ws });
      // By platform, then name; every account, connected or not.
      expect((accounts.accounts as Array<{ display_name: string }>).map((a) => a.display_name)).toEqual(["Zed Insta", "Gone Threads", "Able Tok"]);
      expect(accounts.accounts[0]).toMatchObject({ id: instagram.id, platform: "instagram", profile_id: profile.id, health: "connected", capabilities: { post_types: ["image"] }, tiktok_delivery: "direct" });
      expect(accounts.profiles).toEqual([{ id: profile.id, name: "Brand", description: null, color: expect.anything(), timezone: null }]);
      expect(accounts.last_posted).toEqual([]);
      // The same accounts, in the same order, that the person's own session read through the access policies.
      const viaPolicies = await userSql(userPool, people.ada.id)<{ id: string }>(`SELECT id FROM public.connected_accounts WHERE workspace_id = $1 ORDER BY platform, display_name`, [ws]);
      expect((accounts.accounts as Array<{ id: string }>).map((a) => a.id)).toEqual(viaPolicies.map((a) => a.id));

      const composer = await composerPage(sql, ada(), { workspace_id: ws, post_id: post.id, media_id: pending.id });
      // Only accounts that can be posted to.
      expect((composer.accounts as Array<{ id: string }>).map((a) => a.id).sort()).toEqual([instagram.id, tiktok.id].sort());
      expect((composer.media as Array<{ id: string }>).map((m) => m.id)).toEqual([ready.id]);
      expect(composer.post).toMatchObject({ id: post.id, status: "draft", caption: "Hello", scheduled_at: null, destinations: [{ connected_account_id: instagram.id, platform: "instagram" }], post_media: [{ position: 0, media_asset_id: ready.id }] });
      expect(composer.pending_media).toEqual({ id: pending.id, display_name: null, file_name: "pending.png" });
      // Nothing asked for, nothing extra.
      expect(await composerPage(sql, ada(), { workspace_id: ws })).toMatchObject({ post: null, pending_media: null });
      // Another workspace's post or file, asked for by id, is simply not there.
      expect(await composerPage(sql, ada(), { workspace_id: ws, post_id: bensPost.id, media_id: bens.id })).toMatchObject({ post: null, pending_media: null });

      expect(((await mediaByIds(sql, ada(), { workspace_id: ws, ids: [ready.id, pending.id, bens.id] })).media as Array<{ id: string }>).map((m) => m.id).sort()).toEqual([ready.id, pending.id].sort());

      // The inbox: the platforms it works with, still connected.
      expect(((await inboxAccountsList(sql, ada(), { workspace_id: ws })).accounts as Array<{ id: string }>).map((a) => a.id)).toEqual([instagram.id]);
      expect(gone.id).toBeTruthy();

      for (const read of [accountsPage, composerPage, inboxAccountsList]) await expect(read(sql, ben(), { workspace_id: ws })).rejects.toMatchObject({ status: 404 });
      await expect(mediaByIds(sql, ben(), { workspace_id: ws, ids: [ready.id] })).rejects.toMatchObject({ status: 404 });
    });

    it("gives the calendar, drafts, media library, activity log and API page what they show, from real rows", async () => {
      const ws = people.ben.workspaceId;
      const one = async <T = { id: string }>(query: string, params: unknown[]) => (await sql<T>(query, params))[0];
      const [{ actor_id: actor }] = await sql<{ actor_id: string }>(`SELECT id AS actor_id FROM public.actors WHERE workspace_id = $1 AND user_id = $2`, [ws, people.ben.id]);
      const account = await one(`INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities) VALUES ($1, 'x', $2, $2, 'Ben X', '{}') RETURNING id`, [ws, `x-pages-${suffix}`]);
      const media = await one(`INSERT INTO public.media_assets (workspace_id, storage_key, file_name, mime_type, media_type, size_bytes, width, height, status, uploaded_by_actor_id) VALUES ($1, $2, 'used.png', 'image/png', 'image', 1000, 10, 10, 'ready', $3) RETURNING id`, [ws, `${ws}/${suffix}/used.png`, actor]);
      const hidden = await one(`INSERT INTO public.media_assets (workspace_id, storage_key, file_name, mime_type, media_type, size_bytes, width, height, status, hidden_from_library_at) VALUES ($1, $2, 'hidden.png', 'image/png', 'image', 1000, 10, 10, 'ready', now()) RETURNING id`, [ws, `${ws}/${suffix}/hidden.png`]);
      const post = (status: string, scheduled: string | null, caption: string) =>
        one(`INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy, status, scheduled_at, actor_id) VALUES ($1, 'ui', $2, 'autonomous', $3, $4, $5) RETURNING id`, [ws, caption, status, scheduled, actor]);
      const scheduled = await post("scheduled", "2031-03-10T15:00:00Z", "In the window");
      const later = await post("scheduled", "2031-09-10T15:00:00Z", "Outside the window");
      const draft = await post("draft", null, "A draft");
      const destination = await one(`INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, effective_approval_policy, actor_id) VALUES ($1, $2, $3, 'x', 'autonomous', $4) RETURNING id`, [ws, scheduled.id, account.id, actor]);
      await sql(`INSERT INTO public.post_media (post_id, media_asset_id, workspace_id, position) VALUES ($1, $2, $3, 0)`, [scheduled.id, media.id, ws]);
      await sql(
        `INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, occurred_at) VALUES
           ($1, $2, 'ui', 'post.created', 'post', $3, 'Created a post', '2031-03-01T10:00:00Z'),
           ($1, NULL, 'system', 'destination.failed', 'destination', $4, 'X refused the post', '2031-03-02T10:00:00Z'),
           ($1, $2, 'ui', 'media.uploaded', 'media', $5, 'Uploaded used.png', '2031-03-03T10:00:00Z')`,
        [ws, actor, scheduled.id, destination.id, media.id],
      );
      const ben = (): Caller => ({ userId: people.ben.id, displayName: `ben ${suffix}`, entryPoint: "ui" });
      const adaCaller = (): Caller => ({ userId: people.ada.id, displayName: `ada ${suffix}`, entryPoint: "ui" });
      type Post = { id: string; caption: string; actors: { kind: string } | null; destinations: Array<Record<string, unknown>>; post_media: Array<{ media_assets: { id: string } | null }> };

      // Calendar: posts in the window that aren't drafts, with who made them, where they go and their media.
      const calendar = (await calendarPage(sql, ben(), { workspace_id: ws, from: "2031-03-01T00:00:00Z", to: "2031-04-01T00:00:00Z" })).posts as Post[];
      expect(calendar.map((p) => p.id)).toEqual([scheduled.id]);
      expect(calendar[0]).toMatchObject({ caption: "In the window", status: "scheduled", actors: { kind: "user" }, destinations: [{ platform: "x", connected_account_id: account.id, connected_accounts: { display_name: "Ben X" }, may_be_live: false }], post_media: [{ position: 0, media_assets: { id: media.id, media_type: "image", status: "ready" } }] });
      expect(later.id).not.toBe(scheduled.id);
      // The same posts the person's own session read through the access policies.
      const viaPolicies = await userSql(userPool, people.ben.id)<{ id: string }>(`SELECT id FROM public.posts WHERE workspace_id = $1 AND status <> 'draft' AND scheduled_at >= $2 AND scheduled_at < $3`, [ws, "2031-03-01T00:00:00Z", "2031-04-01T00:00:00Z"]);
      expect(calendar.map((p) => p.id)).toEqual(viaPolicies.map((p) => p.id));

      // Drafts: only drafts (the example every new workspace gets, and ours), newest first.
      const drafts = (await draftsPage(sql, ben(), { workspace_id: ws })).posts as Post[];
      expect(drafts[0]).toMatchObject({ id: draft.id, caption: "A draft" });
      expect(drafts.every((d) => (d as unknown as { status: string }).status === "draft")).toBe(true);
      expect((await draftsPage(sql, ben(), { workspace_id: ws, limit: 1 })).posts).toHaveLength(1);

      // Media library: hidden files only when asked for; how many posts use each.
      const library = (await mediaPage(sql, ben(), { workspace_id: ws })).media as Array<{ id: string; used: number; actors: { kind: string } | null; size_bytes: unknown }>;
      // Newest first; the hidden one isn't there. (An earlier test left one more file here.)
      expect(library[0].id).toBe(media.id);
      expect(library.map((m) => m.id)).not.toContain(hidden.id);
      expect(library[0]).toMatchObject({ used: 1, actors: { kind: "user" } });
      expect(library.filter((m) => m.id !== media.id).every((m) => m.used === 0)).toBe(true);
      expect(Number(library[0].size_bytes)).toBe(1000);
      expect(((await mediaPage(sql, ben(), { workspace_id: ws, hidden: true })).media as Array<{ id: string }>).map((m) => m.id)).toEqual([hidden.id]);

      // Activity: newest first, with the post and account a publishing event was about.
      const log = await activityPage(sql, ben(), { workspace_id: ws, before: "2031-04-01T00:00:00Z", limit: 3 });
      const events = log.events as unknown as Array<{ event_type: string; actors: { kind: string } | null }>;
      expect(events.map((e) => e.event_type)).toEqual(["media.uploaded", "destination.failed", "post.created"]);
      expect(events[1].actors).toBeNull();
      expect(log.destinations).toEqual([expect.objectContaining({ id: destination.id, platform: "x", post_id: scheduled.id, connected_accounts: { display_name: "Ben X" }, actors: expect.objectContaining({ kind: "user" }) })]);
      expect((log.people as Array<{ id: string }>).map((p) => p.id)).toContain(actor);
      const only = async (filter: Record<string, unknown>) => ((await activityPage(sql, ben(), { workspace_id: ws, before: "2031-04-01T00:00:00Z", ...filter })).events as unknown as Array<{ event_type: string }>).map((e) => e.event_type);
      // (Setting the workspace up left a few older entries of its own; ours are the newest.)
      expect(await only({ event_types: ["destination.failed", "media.failed"] })).toEqual(["destination.failed"]);
      expect((await only({ prefixes: ["post.", "destination."] })).slice(0, 2)).toEqual(["destination.failed", "post.created"]);
      expect((await only({ prefixes: ["post.", "destination."] })).every((type) => type.startsWith("post.") || type.startsWith("destination."))).toBe(true);
      // An underscore in a prefix is a letter, not "any character".
      expect(await only({ prefixes: ["p_st."] })).toEqual([]);
      expect((await only({ source: "system" }))[0]).toBe("destination.failed");
      expect(await only({ source: "mcp" })).toEqual([]);
      expect((await only({ actor_id: actor })).slice(0, 2)).toEqual(["media.uploaded", "post.created"]);
      expect(await only({ actor_id: actor })).not.toContain("destination.failed");
      expect((await only({ before: "2031-03-02T10:00:00Z" }))[0]).toBe("post.created");
      expect(await only({ before: "2031-03-02T10:00:00Z" })).not.toContain("destination.failed");

      // API page: keys that still work.
      const made = await createKey(sql, ben(), { workspace_id: ws, name: `Pages ${suffix}`, mode: "test" });
      const api = await apiPage(sql, ben(), { workspace_id: ws });
      expect(api.keys).toEqual([expect.objectContaining({ id: made.id, name: `Pages ${suffix}`, mode: "test", last_used_at: null })]);
      expect(JSON.stringify(api)).not.toContain(made.key);
      expect(api.grants).toEqual([]);

      // Nobody outside the workspace gets any of it.
      for (const read of [calendarPage, draftsPage, mediaPage, activityPage, apiPage]) {
        await expect(read(sql, adaCaller(), { workspace_id: ws, from: "2031-03-01T00:00:00Z", to: "2031-04-01T00:00:00Z" })).rejects.toMatchObject({ status: 404 });
      }
    });
  });

  // Billing's queries ran only against a stand-in database in the unit tests, and the one
  // that adds X posts to an invoice turned out not to be valid Postgres (found on the first
  // real renewal event, 2026-11-26). These run them for real.
  describe("billing on this database", () => {
    const customer = `cus_pg_${suffix}`;
    const calls: Array<{ method: string; path: string; params?: Record<string, unknown> }> = [];
    const stripe: Stripe = {
      async request(method, path, params) {
        calls.push({ method, path, params: params as Record<string, unknown> | undefined });
        return {} as never;
      },
    };
    const deps = { sql, stripe, webAppUrl: "" };

    it("skips a subscription whose workspace no longer exists, and saves one whose workspace does", async () => {
      const gone = "00000000-0000-4000-8000-00000000dead";
      await expect(recordSubscription(sql, gone, { id: "sub_gone", status: "canceled", customer: "cus_gone" })).resolves.toBeNull();
      expect(await sql(`SELECT 1 FROM public.workspace_billing WHERE workspace_id = $1`, [gone])).toEqual([]);
      // The webhook answers such an event as received (no error for Stripe to retry) and bills nothing.
      const event = { type: "customer.subscription.deleted", data: { object: { id: "sub_gone", status: "active", customer: "cus_gone", metadata: { workspace_id: gone } } } };
      await expect(handleStripeEvent(deps, event)).resolves.toEqual({ handled: false, reason: "workspace_gone" });
      expect(calls).toEqual([]);

      await expect(recordSubscription(sql, people.ada.workspaceId, { id: `sub_pg_${suffix}`, status: "active", customer, items: { data: [{ quantity: 3 }] } })).resolves.toBe(true);
      const [row] = await sql<{ subscription_status: string; billed_quantity: number; stripe_customer_id: string }>(
        `SELECT subscription_status, billed_quantity, stripe_customer_id FROM public.workspace_billing WHERE workspace_id = $1`,
        [people.ada.workspaceId],
      );
      expect(row).toEqual({ subscription_status: "active", billed_quantity: 3, stripe_customer_id: customer });
    });

    it("adds each month's unbilled X posts to a renewal invoice, and never twice", async () => {
      // October: a plain post and one with a link, the second in the month's last half hour
      // (UTC). November: one plain post, half an hour into the month.
      await sql(
        `INSERT INTO public.x_charges (destination_id, workspace_id, cents, with_link, created_at) VALUES
           (gen_random_uuid(), $1, 5, false, '2026-10-05T12:00:00Z'),
           (gen_random_uuid(), $1, 25, true, '2026-10-31T23:30:00Z'),
           (gen_random_uuid(), $1, 5, false, '2026-11-01T00:30:00Z')`,
        [people.ada.workspaceId],
      );
      const free = Math.round(X_PRICES.freeMonthly * 100);
      const october = Math.max(0, 30 - free);
      const november = Math.max(0, 5 - free);
      const invoice = { id: `in_pg_${suffix}`, customer, status: "draft", billing_reason: "subscription_cycle" };

      await expect(addXUsageToInvoice(deps, invoice)).resolves.toEqual({ added: october + november });
      const lines = calls.filter((call) => call.path === "/v1/invoiceitems").map((call) => [call.params?.amount, (call.params?.metadata as { month: string }).month]);
      expect(lines).toEqual([[october, "2026-10-01"], [november, "2026-11-01"]].filter(([cents]) => Number(cents) > 0));
      expect(await sql(`SELECT to_char(month, 'YYYY-MM-DD') AS month, cents FROM public.x_invoice_lines WHERE workspace_id = $1 ORDER BY month`, [people.ada.workspaceId])).toEqual(
        [{ month: "2026-10-01", cents: october }, { month: "2026-11-01", cents: november }].filter((line) => line.cents > 0),
      );

      // The next invoice finds those months billed already.
      calls.length = 0;
      await expect(addXUsageToInvoice(deps, { ...invoice, id: `in_pg_next_${suffix}` })).resolves.toEqual({ added: 0 });
      expect(calls).toEqual([]);
      // A customer we have no workspace for: nothing to add, and no error.
      await expect(addXUsageToInvoice(deps, { ...invoice, customer: "cus_nobody_here" })).resolves.toEqual({ added: 0 });
    });
  });

  describe("the Node service on this database", () => {
    const settings: Record<string, string> = {
      WEB_APP_HOME: "https://www.postsocial.xyz/beta/accounts",
      R2_ACCOUNT_ID: "acct", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
      CONNECTIONS_BASE_URL: "https://api.postsocial.xyz/connections",
    };
    const service = createService({ env: (name) => settings[name], base: { sql, userForToken: async () => null }, ready: async () => (await sql("select 1", [])).length === 1, workerSilence: () => secondsSinceWorkerBeat(sql) });
    const call = (path: string, key?: string) => service(new Request(`https://api.postsocial.xyz${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));

    it("reports the worker as down until it beats, up while the beat is recent, and down again when it goes quiet", async () => {
      await sql(`DELETE FROM public.worker_heartbeat`, []);
      const worker = async () => { const response = await call("/readyz/worker"); return [response.status, await response.json()]; };
      expect(await worker()).toEqual([503, { ok: false, seconds: null }]);

      await recordWorkerBeat(sql);
      expect(await worker()).toEqual([200, { ok: true, seconds: 0 }]);
      // A second beat moves the same row forward; there is never more than one.
      await recordWorkerBeat(sql);
      expect(await sql(`SELECT count(*)::int AS rows FROM public.worker_heartbeat`, [])).toEqual([{ rows: 1 }]);

      await sql(`UPDATE public.worker_heartbeat SET beat_at = now() - interval '10 minutes'`, []);
      const [status, body] = await worker();
      expect([status, body.ok]).toEqual([503, false]);
      expect(body.seconds).toBeGreaterThanOrEqual(600);
      expect(await secondsSinceWorkerBeat(sql)).toBeGreaterThanOrEqual(600);
      // The database itself is fine all along.
      expect((await call("/readyz")).status).toBe(200);
    });

    it("is ready, and answers an API key the way the InsForge function does", async () => {
      expect((await call("/readyz")).status).toBe(200);
      const { key } = await createKey(sql, { userId: people.ada.id, displayName: "Ada", entryPoint: "ui" }, { workspace_id: people.ada.workspaceId, name: "pg test", mode: "live" });

      const accounts = await call("/api/v1/accounts", key);
      expect(accounts.status, await accounts.clone().text()).toBe(200);
      const posts = await call("/api/v1/posts", key);
      expect(posts.status, await posts.clone().text()).toBe(200);
      expect(JSON.stringify(await posts.json())).not.toContain(people.ben.workspaceId);

      expect((await call("/api/v1/accounts", "ps_live_not_a_real_key_000000000000000000000000")).status).toBe(401);
      expect((await call("/api/v1/accounts")).status).toBe(401);
    });
  });

  describe("the read-only login for looking at the data", () => {
    // database/viewer.sql, which migrate.mjs --bootstrap runs after the migrations.
    const viewer = new pg.Client(poolConfig({ url: process.env.DATABASE_VIEWER_URL ?? `postgres://app_viewer:local@127.0.0.1:${port}/postsocial` }));
    beforeAll(() => viewer.connect());
    afterAll(() => viewer.end());

    it("reads every row of every table in public, and the list of people", async () => {
      // Both people's workspaces: the rules written for signed-in people hide nothing from it.
      const workspaces = await viewer.query(`select id from public.workspaces where id = any($1::uuid[])`, [[people.ada.workspaceId, people.ben.workspaceId]]);
      expect(workspaces.rowCount).toBe(2);
      const users = await viewer.query(`select email from auth.users where id = any($1::uuid[])`, [[people.ada.id, people.ben.id]]);
      expect(users.rowCount).toBe(2);
      const [gaps] = (
        await viewer.query(
          `select count(*) filter (where not has_table_privilege('app_viewer', c.oid, 'SELECT'))::int as unreadable,
                  count(*) filter (where c.relrowsecurity and not exists (select from pg_policy p where p.polrelid = c.oid and p.polname = 'viewer_reads'))::int as without_rule,
                  count(*)::int as tables
           from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`,
        )
      ).rows;
      expect(gaps.tables).toBeGreaterThanOrEqual(56);
      expect([gaps.unreadable, gaps.without_rule]).toEqual([0, 0]);
    });

    it("starts every session read-only, and can't change anything even with that switched off", async () => {
      expect((await viewer.query(`show default_transaction_read_only`)).rows).toEqual([{ default_transaction_read_only: "on" }]);
      await expect(viewer.query(`UPDATE public.workspaces SET id = id`)).rejects.toThrow(/read-only transaction/);
      await viewer.query(`SET default_transaction_read_only = off`);
      try {
        const changes = [
          `UPDATE public.workspaces SET id = id`,
          `DELETE FROM public.workspaces`,
          `INSERT INTO public.worker_heartbeat DEFAULT VALUES`,
          `TRUNCATE public.workspaces CASCADE`,
          `UPDATE auth.users SET email = email`,
          `CREATE TABLE public.made_by_viewer (id int)`,
          `DROP TABLE public.workspaces`,
        ];
        for (const change of changes) await expect(viewer.query(change), change).rejects.toThrow(/permission denied|must be owner/);
      } finally {
        await viewer.query(`SET default_transaction_read_only = on`);
      }
    });

    it("can't read sessions, password hashes or emailed codes, or become another role", async () => {
      for (const table of ["auth.sessions", "auth.accounts", "auth.verifications"]) await expect(viewer.query(`select 1 from ${table} limit 1`), table).rejects.toThrow(/permission denied/);
      for (const role of ["project_admin", "app_admin", "postsocial_admin"]) await expect(viewer.query(`SET ROLE ${role}`), role).rejects.toThrow(/permission denied/);
    });

    it("gives signed-in people nothing new: its rule names app_viewer only, for reading only", async () => {
      const rules = await sql<{ roles: string; cmd: string }>(`select distinct roles::text as roles, cmd from pg_policies where policyname = 'viewer_reads'`, []);
      expect(rules).toEqual([{ roles: "{app_viewer}", cmd: "SELECT" }]);
      // A signed-in person still sees only their own workspace.
      const mine = await userSql(userPool, people.ada.id)<{ id: string }>(`select id from public.workspaces`, []);
      expect(mine.map((row) => row.id)).toEqual([people.ada.workspaceId]);
    });
  });

  it("a login can sign in with a password that was only ever sent to the database as a hash", async () => {
    // What migrate.mjs --bootstrap does on AWS for app_admin, on a throwaway login here.
    const role = `test_login_${suffix.replace(/[^a-z0-9]/g, "_")}`;
    const password = `pw${suffix.replace(/[^a-z0-9]/g, "")}0123456789abcdef`;
    const owner = new pg.Client(poolConfig({ url: ownerUrl }));
    await owner.connect();
    try {
      await owner.query(`CREATE ROLE ${role} LOGIN`);
      await owner.query(setPasswordStatement(role, password));
      const [{ rolpassword }] = (await owner.query(`select rolpassword from pg_authid where rolname = $1`, [role]).catch(() => ({ rows: [{ rolpassword: null }] }))).rows;
      // Only a superuser can read pg_authid; when we can, check nothing but the hash is stored.
      if (rolpassword) expect(rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);

      const login = new pg.Client(poolConfig({ host: "127.0.0.1", port: Number(port), database: "postsocial", user: role, password }));
      await login.connect();
      expect((await login.query("select current_user as who")).rows).toEqual([{ who: role }]);
      await login.end();

      const wrong = new pg.Client(poolConfig({ host: "127.0.0.1", port: Number(port), database: "postsocial", user: role, password: `${password}x` }));
      await expect(wrong.connect()).rejects.toThrow(/password authentication failed/);
      await wrong.end().catch(() => {});
      expect(scramVerifier(password)).not.toContain(password);
    } finally {
      await owner.query(`DROP ROLE IF EXISTS ${role}`);
      await owner.end();
    }
  });
});
