// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ callServer: vi.fn() }));
vi.mock("@/lib/beta/workspace", () => server);

import { inboxAccounts } from "./inbox-nav";

const fromDatabase = (rows: unknown[]) => {
  const chain = { select: () => chain, eq: () => chain, in: () => chain, neq: () => chain, order: async () => ({ data: rows }) };
  return { database: { from: vi.fn(() => chain) } } as never;
};
const ROWS = [
  { id: "a1", platform: "instagram", handle: "ada", display_name: "Ada", external_account_id: "17890" },
  { id: "a2", platform: "linkedin", handle: "ada-b", display_name: "Ada B", external_account_id: "person:abc" },
  { id: "a3", platform: "linkedin", handle: "pentridge", display_name: "Pentridge", external_account_id: "organization:42" },
];
const SHOWN = [
  { id: "a1", platform: "instagram", handle: "ada", display_name: "Ada" },
  { id: "a3", platform: "linkedin", handle: "pentridge", display_name: "Pentridge" },
];

beforeEach(() => server.callServer.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("the inbox's accounts", () => {
  it("come from the database with the person's session, keeping LinkedIn Company Pages only", async () => {
    const client = fromDatabase(ROWS);
    expect(await inboxAccounts(client, "w1", "a3")).toEqual({ accounts: SHOWN, account: "a3" });
    expect(server.callServer).not.toHaveBeenCalled();
  });

  it("come from our API when the pages read through it, shown the same way", async () => {
    vi.stubEnv("PAGE_READS", "api");
    server.callServer.mockResolvedValue({ accounts: ROWS });
    const client = fromDatabase([]);
    expect(await inboxAccounts(client, "w1", "not-one-of-them")).toEqual({ accounts: SHOWN, account: null });
    expect(server.callServer).toHaveBeenCalledWith("inbox_accounts", { workspace_id: "w1" });
    expect((client as unknown as { database: { from: ReturnType<typeof vi.fn> } }).database.from).not.toHaveBeenCalled();
  });

  it("show none, rather than failing the page, when the read doesn't come back", async () => {
    vi.stubEnv("PAGE_READS", "api");
    server.callServer.mockResolvedValue(null);
    expect(await inboxAccounts(fromDatabase([]), "w1")).toEqual({ accounts: [], account: null });
  });
});
