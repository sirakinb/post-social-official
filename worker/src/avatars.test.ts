import { describe, expect, it, vi } from "vitest";
import { avatarPath, MAX_AVATAR_BYTES, syncAvatars, type AvatarDeps } from "./avatars";
import { Response as UndiciResponse } from "undici";

vi.mock("./credentials", () => ({
  accountToken: vi.fn(async (_deps: unknown, account: { id: string }) => {
    if (account.id === "no-access") throw new Error("Reconnect it.");
    return `token-${account.id}`;
  }),
}));

type Row = { id: string; workspace_id: string; platform: string; external_account_id: string; display_name: string; avatar_url: string | null; avatar_key: string | null };

function setup(rows: Row[], pictures: Record<string, { type: string; body: Uint8Array | string }>, platformAnswer: (url: string) => unknown) {
  const updates: unknown[][] = [];
  const sql = vi.fn(async (query: string, params: unknown[]) => {
    if (query.includes("avatar_attempted_at = now()")) return rows;
    updates.push([query.trim().split("\n")[0], ...params]);
    return query.includes("RETURNING id") ? [{ id: params[0] }] : [];
  });
  const put = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  const http = vi.fn(async (input: string | URL) => new Response(JSON.stringify(platformAnswer(String(input))), { status: 200 })) as unknown as typeof fetch;
  const download = vi.fn(async (url: string) => {
    const picture = pictures[url];
    if (!picture) throw new Error("not found");
    return { response: new UndiciResponse(picture.body, { headers: { "content-type": picture.type } }), close: async () => {} };
  });
  const deps: AvatarDeps = { sql: sql as never, r2: { put, delete: del } as never, setting: () => "x", download: download as never, http };
  return { deps, updates, put, del, download };
}

const row = (over: Partial<Row>): Row => ({ id: "acct", workspace_id: "ws", platform: "instagram", external_account_id: "ext", display_name: "Aki", avatar_url: null, avatar_key: null, ...over });

describe("profile picture copies", () => {
  it("asks the platform for a fresh picture, saves our copy and points the account at our address", async () => {
    const { deps, updates, put } = setup(
      [row({ avatar_url: "https://cdn.example/expired.jpg" })],
      { "https://cdn.example/fresh.jpg": { type: "image/jpeg", body: new Uint8Array([1, 2, 3]) } },
      () => ({ profile_picture_url: "https://cdn.example/fresh.jpg" }),
    );
    expect(await syncAvatars(deps)).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
    const [key, , type] = put.mock.calls[0] as unknown as [string, Uint8Array, string];
    expect(key).toMatch(/^workspaces\/ws\/avatars\/acct\/[0-9a-f]{16}\.jpg$/);
    expect(type).toBe("image/jpeg");
    const version = key.match(/([0-9a-f]{16})\.jpg$/)![1];
    const saved = updates.find((u) => String(u[0]).includes("avatar_key = $2"));
    expect(saved?.slice(1)).toEqual(["acct", key, avatarPath("acct", version)]);
    expect(avatarPath("acct", version)).toBe(`/api/avatars/acct/${version}`);
  });

  it("keeps the same file when the picture hasn't changed, and removes the old file when it has", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const first = setup([row({})], { "https://cdn.example/p.png": { type: "image/png", body: bytes } }, () => ({ profile_picture_url: "https://cdn.example/p.png" }));
    await syncAvatars(first.deps);
    const key = (first.put.mock.calls[0] as unknown as [string])[0];

    const same = setup([row({ avatar_key: key, avatar_url: "/api/avatars/acct/x" })], { "https://cdn.example/p.png": { type: "image/png", body: bytes } }, () => ({ profile_picture_url: "https://cdn.example/p.png" }));
    await syncAvatars(same.deps);
    expect(same.put).not.toHaveBeenCalled();
    expect(same.del).not.toHaveBeenCalled();

    const changed = setup([row({ avatar_key: key })], { "https://cdn.example/new.png": { type: "image/png", body: new Uint8Array([7]) } }, () => ({ profile_picture_url: "https://cdn.example/new.png" }));
    await syncAvatars(changed.deps);
    expect(changed.put).toHaveBeenCalledTimes(1);
    expect(changed.del).toHaveBeenCalledWith(key);
  });

  it("falls back to the link saved at connect time when the platform can't be asked", async () => {
    const { deps, put } = setup(
      [row({ id: "no-access", avatar_url: "https://cdn.example/at-connect.jpg" })],
      { "https://cdn.example/at-connect.jpg": { type: "image/jpeg", body: new Uint8Array([4]) } },
      () => ({}),
    );
    expect(await syncAvatars(deps)).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("marks accounts with no picture to share as checked, without saving anything", async () => {
    const { deps, updates, put, download } = setup([row({ platform: "youtube" })], {}, () => ({}));
    expect(await syncAvatars(deps)).toBe(1);
    expect(download).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(updates.some((u) => String(u[0]).includes("avatar_synced_at = now()"))).toBe(true);
  });

  it("refuses files that aren't pictures or are too large, keeping the last good copy; one failure doesn't stop the rest", async () => {
    const { deps, put, updates } = setup(
      [row({ id: "a", avatar_key: "workspaces/ws/avatars/a/old.jpg" }), row({ id: "b" }), row({ id: "c" })],
      {
        "https://cdn.example/a": { type: "text/html", body: "<html>" },
        "https://cdn.example/b": { type: "image/jpeg", body: new Uint8Array(MAX_AVATAR_BYTES + 1) },
        "https://cdn.example/c": { type: "image/webp", body: new Uint8Array([1]) },
      },
      (url) => ({ profile_picture_url: `https://cdn.example/${url.includes("token-a") ? "a" : url.includes("token-b") ? "b" : "c"}` }),
    );
    expect(await syncAvatars(deps)).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0] as unknown as [string])[0]).toMatch(/avatars\/c\/[0-9a-f]{16}\.webp$/);
    expect(updates.filter((u) => String(u[0]).includes("avatar_key = $2")).map((u) => u[1])).toEqual(["c"]);
  });
});
