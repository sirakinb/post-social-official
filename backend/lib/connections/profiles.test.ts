// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Caller, Sql } from "../access";
import { cleanTimezone, createProfile, deleteProfile, moveAccount, updateProfile } from "./profiles";

const WS = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const person: Caller = { userId: "u1", displayName: "Aki", entryPoint: "ui" };

// A fake database: answers each query with the first matching rule, records the calls.
function fakeSql(rules: Array<[RegExp, unknown[]]>, role = "member") {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const sql = vi.fn(async (query: string, params: unknown[]) => {
    calls.push({ query, params });
    if (/FROM public\.workspace_members m/.test(query)) return role ? [{ role, actor_id: "actor-1" }] : [];
    return rules.find(([pattern]) => pattern.test(query))?.[1] ?? [];
  }) as unknown as Sql;
  return { sql, calls };
}

describe("profiles", () => {
  it("creates a profile with a cleaned name, colour and time zone, audited", async () => {
    const { sql, calls } = fakeSql([[/count\(\*\)::int AS count/, [{ count: 0 }]], [/INSERT INTO public\.profiles/, [{ id: PROFILE, name: "Vibe Code Philly" }]]]);
    const result = await createProfile(sql, person, { workspace_id: WS, name: "  Vibe   Code Philly ", color: "#3dd68c", timezone: "America/New_York" });
    expect(result.profile).toMatchObject({ id: PROFILE });
    const insert = calls.find((c) => /INSERT INTO public\.profiles/.test(c.query))!;
    expect(insert.params.slice(0, 5)).toEqual([WS, "Vibe Code Philly", null, "#3DD68C", "America/New_York"]);
    expect(insert.query).toMatch(/'profile\.created'/);
  });

  it("refuses reviewers, bad colours, unknown time zones and missing names", async () => {
    await expect(createProfile(fakeSql([], "reviewer").sql, person, { workspace_id: WS, name: "A" })).rejects.toThrow(/Reviewers cannot change profiles/);
    await expect(createProfile(fakeSql([]).sql, person, { workspace_id: WS, name: "A", color: "purple" })).rejects.toThrow(/#9B6CFF/);
    await expect(createProfile(fakeSql([]).sql, person, { workspace_id: WS, name: "A", timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(createProfile(fakeSql([]).sql, person, { workspace_id: WS, name: "   " })).rejects.toThrow(/name/);
    expect(cleanTimezone("")).toBeNull();
  });

  it("turns a duplicate name into a plain conflict", async () => {
    const sql = vi.fn(async (query: string) => {
      if (/workspace_members/.test(query)) return [{ role: "owner", actor_id: "a" }];
      if (/count\(\*\)::int AS count/.test(query)) return [{ count: 1 }];
      throw new Error('duplicate key value violates unique constraint "profiles_workspace_name_idx"');
    }) as unknown as Sql;
    await expect(createProfile(sql, person, { workspace_id: WS, name: "Still" })).rejects.toMatchObject({ status: 409, message: "There is already a profile called Still." });
  });

  it("keeps fields that an update leaves out", async () => {
    const before = { id: PROFILE, workspace_id: WS, name: "Still", description: "Meditation", color: "#9B6CFF", timezone: "UTC", created_at: "" };
    const { sql, calls } = fakeSql([[/SELECT id, workspace_id, name/, [before]], [/UPDATE public\.profiles/, [{ ...before, color: "#F5B54A" }]]]);
    await updateProfile(sql, person, { profile_id: PROFILE, color: "#F5B54A" });
    const update = calls.find((c) => /UPDATE public\.profiles/.test(c.query))!;
    expect(update.params.slice(0, 5)).toEqual([PROFILE, "Still", "Meditation", "#F5B54A", "UTC"]);
  });

  it("hides another workspace's profile behind not found", async () => {
    const { sql } = fakeSql([[/SELECT id, workspace_id, name/, [{ id: PROFILE, workspace_id: WS, name: "X" }]]], "");
    await expect(deleteProfile(sql, person, { profile_id: PROFILE })).rejects.toMatchObject({ status: 404, message: "That profile was not found." });
  });

  it("moves an account only to a profile in its own workspace", async () => {
    const account = { id: ACCOUNT, workspace_id: WS, platform: "x", display_name: "Defi Papi", profile_id: null };
    const missing = fakeSql([[/FROM public\.connected_accounts WHERE id/, [account]]]);
    await expect(moveAccount(missing.sql, person, { account_id: ACCOUNT, profile_id: PROFILE })).rejects.toThrow(/profile was not found/);
    expect(missing.calls.find((c) => /FROM public\.profiles WHERE id = \$1 AND workspace_id = \$2/.test(c.query))?.params).toEqual([PROFILE, WS]);

    const ok = fakeSql([[/FROM public\.connected_accounts WHERE id/, [account]], [/FROM public\.profiles WHERE id/, [{ id: PROFILE, name: "Still" }]]]);
    expect(await moveAccount(ok.sql, person, { account_id: ACCOUNT, profile_id: PROFILE })).toEqual({ account_id: ACCOUNT, profile_id: PROFILE });
    expect(ok.calls.at(-1)!.params).toContain("Moved X account Defi Papi to Still");
  });

  it("takes an account out of its profile with none", async () => {
    const { sql, calls } = fakeSql([[/FROM public\.connected_accounts WHERE id/, [{ id: ACCOUNT, workspace_id: WS, platform: "x", display_name: "D", profile_id: PROFILE }]]]);
    expect(await moveAccount(sql, person, { account_id: ACCOUNT, profile_id: "none" })).toEqual({ account_id: ACCOUNT, profile_id: null });
    expect(calls.at(-1)!.query).toMatch(/'account\.moved'/);
  });
});
