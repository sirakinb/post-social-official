import { cookies } from "next/headers";
import { GetStartedPanel } from "@/components/beta/get-started";
import { GET_STARTED_HIDDEN_COOKIE, loadGetStarted, stepsDone } from "@/lib/beta/get-started";
import { ACCOUNT_ERRORS, ACCOUNT_NOTICES, FLASH_COOKIE, noticeText, readFlash } from "@/lib/beta/flash";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { pageReadsViaApi } from "@/lib/sign-in/rules";
import { hideGetStarted } from "./actions";
import { reconnectGains } from "../../../../../backend/lib/connections/upgrades";
import { ConnectionsView, type Profile, type SocialAccount } from "./connections-view";

export const metadata = { title: "Accounts · Post Social" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; message?: string; error?: string; connect?: string; profile?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/accounts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const COLUMNS = "id, platform, handle, display_name, avatar_url, health, health_reason, capabilities, created_at";
  const accountsQuery = (columns: string) => client.database.from("connected_accounts").select(columns).eq("workspace_id", workspace.id).order("platform").order("display_name");
  // The get-started steps: for people who can post, until all three are done or hidden.
  const jar = await cookies();
  const showSteps = workspace.role !== "reviewer" && !jar.get(GET_STARTED_HIDDEN_COOKIE);
  // Only known codes from the address are shown, in our own words (see lib/beta/flash).
  const flash = jar.get(FLASH_COOKIE)?.value;
  const error = noticeText(ACCOUNT_ERRORS, params.error, readFlash(flash, "error"));
  const notice = error ? null : noticeText(ACCOUNT_NOTICES, params.message, readFlash(flash, "notice"));
  type AccountRow = { id: string; platform: string; handle: string; display_name: string; avatar_url: string | null; health: string; health_reason: string | null; capabilities: { post_types?: string[]; account_kind?: "profile" | "page" } | null; created_at: string; profile_id?: string | null; scopes?: string[] | null; last_connected_at?: string | null };
  // What the page shows, from our API in one read, or (until every environment has moved)
  // straight from the database with the person's InsForge session.
  const read = async () => {
    if (pageReadsViaApi()) {
      const [page, steps] = await Promise.all([
        callServer<{ accounts: Array<AccountRow & { tiktok_delivery: "direct" | "inbox" }>; last_posted: Array<{ connected_account_id: string; updated_at: string }>; profiles: Profile[] }>("accounts_page", { workspace_id: workspace.id }),
        showSteps ? loadGetStarted(client, workspace.id) : null,
      ]);
      return {
        accountRows: (page?.accounts ?? []) as AccountRow[],
        accountError: !page,
        lastPosts: page?.last_posted ?? [],
        profileRows: page?.profiles ?? [],
        profilesReady: true,
        delivery: new Map((page?.accounts ?? []).filter((a) => a.platform === "tiktok").map((a) => [a.id, a.tiktok_delivery])),
        deliveryKnown: Boolean(page),
        steps,
      };
    }
    const [accountsResult, { data: lastPosts }, profilesResult, deliveryResult, steps] = await Promise.all([
      accountsQuery(`${COLUMNS}, profile_id, scopes, last_connected_at`),
      client.database.from("destinations").select("connected_account_id, updated_at").eq("workspace_id", workspace.id).eq("status", "published").order("updated_at", { ascending: false }).limit(200),
      client.database.from("profiles").select("id, name, description, color, timezone").eq("workspace_id", workspace.id).order("name"),
      // Before the TikTok delivery migration reaches an environment, this fails and the setting stays hidden.
      client.database.from("connected_accounts").select("id, tiktok_delivery").eq("workspace_id", workspace.id).eq("platform", "tiktok"),
      showSteps ? loadGetStarted(client, workspace.id) : null,
    ]);
    // Before the profiles migration reaches an environment, read accounts without them.
    const profilesReady = !profilesResult.error;
    if (profilesResult.error) console.error("profiles could not be read", profilesResult.error);
    const { data: accountRows, error: accountError } = profilesReady && !accountsResult.error ? accountsResult : await accountsQuery(COLUMNS);
    return {
      accountRows: (accountRows ?? []) as unknown as AccountRow[],
      accountError: Boolean(accountError),
      lastPosts: (lastPosts ?? []) as Array<{ connected_account_id: string; updated_at: string }>,
      profileRows: (profilesResult.data ?? []) as Profile[],
      profilesReady,
      delivery: new Map(((deliveryResult.data ?? []) as Array<{ id: string; tiktok_delivery: "direct" | "inbox" }>).map((r) => [r.id, r.tiktok_delivery])),
      deliveryKnown: !deliveryResult.error,
      steps,
    };
  };
  const { accountRows, accountError, lastPosts, profileRows, profilesReady, delivery, deliveryKnown, steps } = await read();
  const profiles = [...profileRows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const lastPosted = new Map<string, string>();
  for (const d of lastPosts) if (!lastPosted.has(d.connected_account_id)) lastPosted.set(d.connected_account_id, d.updated_at);

  const accounts: SocialAccount[] = accountRows.map((a) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    name: a.display_name,
    avatarUrl: a.avatar_url,
    health: a.health,
    reason: a.health_reason,
    postTypes: a.capabilities?.post_types ?? [],
    accountKind: a.capabilities?.account_kind ?? null,
    connectedAt: a.created_at,
    lastPostedAt: lastPosted.get(a.id) ?? null,
    profileId: a.profile_id ?? null,
    tiktokDelivery: deliveryKnown ? (delivery.get(a.id) ?? null) : null,
    // What a reconnect would turn on (Inbox, official stats); unknown before the migration.
    gains: a.last_connected_at === undefined ? null : reconnectGains({ platform: a.platform, health: a.health, scopes: a.scopes ?? null, lastConnectedAt: a.last_connected_at }),
  }));


  return (
    <ConnectionsView
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
      role={workspace.role}
      accounts={accounts}
      profiles={profiles}
      profilesReady={profilesReady}
      filter={params.profile ?? null}
      connectProfile={params.connect ? (params.profile ?? null) : null}
      loadError={accountError}
      notice={notice}
      error={error}
      requested={params.connect ?? null}
      getStarted={steps && stepsDone(steps) < 3 ? <GetStartedPanel steps={steps} hide={hideGetStarted} /> : null}
    />
  );
}
