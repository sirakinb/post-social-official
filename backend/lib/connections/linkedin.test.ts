// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Sql } from "../access";
import { LINKEDIN_PAGES_SCOPES, isLinkedInPage, linkedinApp, linkedinAuthor } from "./linkedin";
import { authorizeUrl, currentAvatarUrl, exchangeCode, revokeTokens } from "./platforms";
import { chooseAccounts, completeConnection, disconnectAccount, pendingChoices } from "./service";

const KEY = randomBytes(32).toString("base64");
const base: Record<string, string> = {
  LINKEDIN_CLIENT_ID: "old-client",
  LINKEDIN_CLIENT_SECRET: "old-secret",
  CONNECTIONS_BASE_URL: "https://fn.example/connections",
  CREDENTIAL_ENCRYPTION_KEY: KEY,
};
const pages: Record<string, string> = { ...base, LINKEDIN_PAGES_CLIENT_ID: "pages-client", LINKEDIN_PAGES_CLIENT_SECRET: "pages-secret" };
const settingFrom = (values: Record<string, string>) => (name: string) => {
  if (!(name in values)) throw new Error(`missing ${name}`);
  return values[name];
};

// A fake LinkedIn: answers by URL, records requests.
function fakeHttp(routes: Array<[RegExp, unknown, number?]>) {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? String(init.body) : "" });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
    return new Response(JSON.stringify(route[1]), { status: route[2] ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}

// The member and two Pages they can post for; a third they only analyse, a fourth requested.
const LINKEDIN = (extra: Array<[RegExp, unknown, number?]> = []) => fakeHttp([
  [/oauth\/v2\/accessToken/, { access_token: "member-token", expires_in: 5184000, scope: LINKEDIN_PAGES_SCOPES.join(",") }],
  [/v2\/me\?/, { id: "m1", localizedFirstName: "Aki", localizedLastName: "B", profilePicture: { "displayImage~": { elements: [
    { identifiers: [{ identifier: "https://media.licdn.com/small.jpg" }] },
    { identifiers: [{ identifier: "https://media.licdn.com/large.jpg" }] },
  ] } } }],
  [/organizationAcls/, { elements: [
    { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:101" },
    { role: "CONTENT_ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:202" },
    { role: "ANALYST", state: "APPROVED", organization: "urn:li:organization:303" },
    { role: "ADMINISTRATOR", state: "REQUESTED", organization: "urn:li:organization:404" },
  ] }],
  ...extra,
  [/organizations\/101/, { id: 101, localizedName: "Pentridge Media", vanityName: "pentridge" }],
  [/organizations\/202/, { id: 202, localizedName: "Post Social" }],
]);

describe("LinkedIn accounts", () => {
  it("tells Pages from profiles and posts as the right author", () => {
    expect(isLinkedInPage("organization:101")).toBe(true);
    expect(isLinkedInPage("m1")).toBe(false);
    expect(linkedinAuthor("organization:101")).toBe("urn:li:organization:101");
    expect(linkedinAuthor("m1")).toBe("urn:li:person:m1");
  });

  it("uses the Community Management app only where it is set up", () => {
    expect(linkedinApp(settingFrom(base))).toEqual({ clientId: "old-client", clientSecret: "old-secret", pages: false });
    expect(linkedinApp(settingFrom(pages))).toEqual({ clientId: "pages-client", clientSecret: "pages-secret", pages: true });
    const url = new URL(authorizeUrl("linkedin", "s", "https://cb", settingFrom(pages)));
    expect(url.searchParams.get("client_id")).toBe("pages-client");
    expect(url.searchParams.get("scope")).toBe(LINKEDIN_PAGES_SCOPES.join(" "));
    expect(new URL(authorizeUrl("linkedin", "s", "https://cb", settingFrom(base))).searchParams.get("scope")).toBe("openid profile w_member_social");
  });

  it("signs in to the profile and every Page the member can post for", async () => {
    const { http, calls } = LINKEDIN();
    const identities = await exchangeCode("linkedin", "code", "https://cb", settingFrom(pages), http);
    expect(calls[0].body).toContain("client_id=pages-client");
    expect(identities.map((i) => [i.externalAccountId, i.displayName, i.handle, i.capabilities.account_kind])).toEqual([
      ["m1", "Aki B", "Aki B", "profile"],
      ["organization:101", "Pentridge Media", "pentridge", "page"],
      ["organization:202", "Post Social", "Post Social", "page"],
    ]);
    expect(identities[0].avatarUrl).toBe("https://media.licdn.com/large.jpg");
    // One member sign-in: every account shares its token and owner.
    expect(new Set(identities.map((i) => i.tokens.accessToken))).toEqual(new Set(["member-token"]));
    expect(new Set(identities.map((i) => i.ownerExternalId))).toEqual(new Set(["m1"]));
    expect(identities[1].capabilities.notes).toContain("Company Page");
  });

  it("leaves out a Page that can't be read instead of failing the sign-in", async () => {
    const { http } = LINKEDIN([[/organizations\/202/, { message: "Not enough permissions" }, 403]]);
    const identities = await exchangeCode("linkedin", "code", "https://cb", settingFrom(pages), http);
    expect(identities.map((i) => i.externalAccountId)).toEqual(["m1", "organization:101"]);
  });

  it("revokes with the app that signed in", async () => {
    const { http, calls } = fakeHttp([[/oauth\/v2\/revoke/, {}]]);
    expect(await revokeTokens("linkedin", { accessToken: "a" }, settingFrom(pages), http)).toBe("confirmed");
    expect(calls[0].body).toContain("client_id=pages-client");
  });

  it("keeps the saved picture where the new app can't read one", async () => {
    const { http } = fakeHttp([[/userinfo/, { message: "Not enough permissions" }, 403]]);
    expect(await currentAvatarUrl("linkedin", "m1", "t", http)).toBeNull();
    expect(await currentAvatarUrl("linkedin", "organization:101", "t", http)).toBeNull();
  });
});

// A small stand-in for the database: the rows these flows read and write.
function fakeDb(connected: string[] = [], options: { otherSharing?: boolean } = {}) {
  const saved: string[] = [];
  const pending = new Map<string, Record<string, unknown>>();
  let revokedLookups = 0;
  const sql = (async (query: string, params: unknown[] = []) => {
    if (query.includes("UPDATE public.oauth_states")) return [{ workspace_id: "w1", user_id: "user-1", return_to: "https://app.example/beta/accounts?workspace=ws", code_verifier_encrypted: null, profile_id: null }];
    if (query.includes("FROM public.workspace_members")) return [{ role: "owner", actor_id: "a1" }];
    if (query.includes("WITH member AS")) return [{ role: "owner", actor_id: "a1" }];
    if (query.includes("workspace_id <> $3")) return [];
    if (query.includes("external_account_id = ANY")) return (params[2] as string[]).filter((id) => connected.includes(id)).map((id) => ({ external_account_id: id }));
    if (query.includes("INSERT INTO public.connected_accounts")) {
      saved.push(String(params[2]));
      return [{ event_type: connected.includes(String(params[2])) ? "account.reconnected" : "account.connected" }];
    }
    if (query.includes("INSERT INTO public.pending_connections")) {
      pending.set("11111111-1111-4111-8111-111111111111", { workspace_id: params[0], user_id: params[1], platform: params[2], profile_id: params[3], return_to: params[4], choices: JSON.parse(String(params[5])), encrypted_payload: params[6], initialization_vector: params[7] });
      return [{ id: "11111111-1111-4111-8111-111111111111" }];
    }
    if (query.includes("SELECT platform, choices, workspace_id FROM public.pending_connections")) {
      const row = pending.get(String(params[0]));
      return row && row.user_id === params[1] ? [row] : [];
    }
    if (query.includes("DELETE FROM public.pending_connections")) {
      const row = pending.get(String(params[0]));
      if (!row || row.user_id !== params[1]) return [];
      pending.delete(String(params[0]));
      return [row];
    }
    if (query.includes("SELECT id, workspace_id, platform, display_name, health, owner_external_id")) return [{ id: params[0], workspace_id: "w1", platform: "linkedin", display_name: "Pentridge Media", health: "connected", owner_external_id: "m1" }];
    if (query.includes("owner_external_id = $1 AND id <> $2")) return options.otherSharing ? [{ id: "other" }] : [];
    if (query.includes("FROM public.credentials")) { revokedLookups++; return []; }
    if (query.includes("disconnect_account")) return [{ cancelled: 0 }];
    return [];
  }) as unknown as Sql;
  return { sql, saved, pending, revokedLookups: () => revokedLookups };
}

const person = { userId: "user-1", displayName: "Aki", entryPoint: "ui" as const };

describe("choosing which LinkedIn accounts to connect", () => {
  const finish = (db: ReturnType<typeof fakeDb>, http: typeof fetch) =>
    completeConnection({ sql: db.sql, setting: settingFrom(pages), allowedReturnOrigins: [], http }, "linkedin", new URLSearchParams({ state: "s", code: "c" }), "user-1");

  it("adds nothing new until the person chooses, but reconnects what the workspace already has", async () => {
    const db = fakeDb(["m1"]);
    const result = await finish(db, LINKEDIN().http);
    expect(result.ok).toBe(true);
    expect(result.choose).toBe("11111111-1111-4111-8111-111111111111");
    expect(db.saved).toEqual(["m1"]);
    expect(result.message).toBe("Reconnected Aki B. Choose which LinkedIn accounts to add.");
    // What the person chooses from carries no tokens.
    const offered = await pendingChoices({ sql: db.sql, setting: settingFrom(pages), allowedReturnOrigins: [] }, person, { pending_id: result.choose });
    expect(offered.choices).toEqual([
      { external_id: "organization:101", name: "Pentridge Media", kind: "page", avatar_url: null },
      { external_id: "organization:202", name: "Post Social", kind: "page", avatar_url: null },
    ]);
    expect(JSON.stringify(offered)).not.toContain("member-token");
  });

  it("connects only the ticked accounts, once", async () => {
    const db = fakeDb();
    const { choose } = await finish(db, LINKEDIN().http);
    const deps = { sql: db.sql, setting: settingFrom(pages), allowedReturnOrigins: [] };
    const result = await chooseAccounts(deps, person, { pending_id: choose, external_ids: ["organization:202", "organization:999"] });
    expect(db.saved).toEqual(["organization:202"]);
    expect(result.message).toBe("Connected Post Social.");
    await expect(chooseAccounts(deps, person, { pending_id: choose, external_ids: ["organization:101"] })).rejects.toThrow("This sign-in expired");
    expect(db.saved).toEqual(["organization:202"]);
  });

  it("lets only the person who signed in choose", async () => {
    const db = fakeDb();
    const { choose } = await finish(db, LINKEDIN().http);
    const deps = { sql: db.sql, setting: settingFrom(pages), allowedReturnOrigins: [] };
    await expect(chooseAccounts(deps, { ...person, userId: "someone-else" }, { pending_id: choose, external_ids: ["m1"] })).rejects.toThrow("This sign-in expired");
    await expect(pendingChoices(deps, { kind: "key", credentialId: "k1", workspaceId: "w1", actorId: "a", role: "admin", entryPoint: "api" } as never, { pending_id: choose })).rejects.toThrow("connected by a person");
    expect(db.saved).toEqual([]);
  });

  it("connects straight away when the sign-in brings one account", async () => {
    const db = fakeDb();
    const { http } = fakeHttp([
      [/oauth\/v2\/accessToken/, { access_token: "member-token", expires_in: 5184000 }],
      [/v2\/me\?/, { id: "m1", localizedFirstName: "Aki", localizedLastName: "B" }],
      [/organizationAcls/, { elements: [] }],
    ]);
    const result = await finish(db, http);
    expect(result.choose).toBeUndefined();
    expect(db.saved).toEqual(["m1"]);
    expect(result.message).toBe("Connected Aki B.");
  });

  it("keeps the shared sign-in when another account still uses it", async () => {
    const db = fakeDb([], { otherSharing: true });
    const result = await disconnectAccount({ sql: db.sql, setting: settingFrom(pages), allowedReturnOrigins: [] }, person, { account_id: "22222222-2222-4222-8222-222222222222" });
    expect(result.revoked).toBe("shared_with_other_accounts");
    expect(db.revokedLookups()).toBe(0);
  });
});
