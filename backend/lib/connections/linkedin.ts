// LinkedIn through the Community Management API app ("Post Social Pages"): one sign-in
// brings the member's own profile and every Company Page they can post for. Used only where
// that app is set up (LINKEDIN_PAGES_CLIENT_ID); elsewhere the original Share on LinkedIn app
// signs in as before (platforms.ts).
//
// Every account from one sign-in shares the member's token: a Page acts through its admin.
// A Page is saved with the external id "organization:{id}"; a profile keeps its bare member
// id, so a profile connected through either app is the same account.
import type { Capabilities, Identity, Settings } from "./platforms";

export const LINKEDIN_API = "https://api.linkedin.com/rest";
// LinkedIn's API versions (YYYYMM) are supported for about a year.
export const LINKEDIN_VERSION = "202609";

// The member signs in and posts as themselves; Pages need the organization permissions.
// Comment permissions are asked now so the Inbox needs no second sign-in later.
export const LINKEDIN_PAGES_SCOPES = [
  "r_basicprofile",
  "w_member_social",
  "r_member_postAnalytics",
  "r_member_profileAnalytics",
  "rw_organization_admin",
  "w_organization_social",
  "r_organization_social",
  "r_organization_followers",
  "r_organization_social_feed",
  "w_organization_social_feed",
];

// Page roles that can post as the Page.
const POSTING_ROLES = new Set(["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"]);
// A sign-in lists at most this many Pages.
const MAX_PAGES = 100;

const PAGE_PREFIX = "organization:";

export type LinkedInApp = { clientId: string; clientSecret: string; pages: boolean };

function optional(setting: Settings, name: string) {
  try {
    return setting(name) ?? "";
  } catch {
    return "";
  }
}

// The app this environment signs in with. Tokens are refreshed and revoked with the same app.
// Both keys must be set: with only one, the original app keeps working.
export function linkedinApp(setting: Settings): LinkedInApp {
  const id = optional(setting, "LINKEDIN_PAGES_CLIENT_ID");
  const secret = optional(setting, "LINKEDIN_PAGES_CLIENT_SECRET");
  if (id && secret) return { clientId: id, clientSecret: secret, pages: true };
  return { clientId: setting("LINKEDIN_CLIENT_ID"), clientSecret: setting("LINKEDIN_CLIENT_SECRET"), pages: false };
}

export const isLinkedInPage = (externalId: string | null | undefined) => typeof externalId === "string" && externalId.startsWith(PAGE_PREFIX);
export const linkedinPageExternalId = (organizationId: string) => `${PAGE_PREFIX}${organizationId}`;

// The author a post is made as.
export function linkedinAuthor(externalId: string) {
  return isLinkedInPage(externalId) ? `urn:li:organization:${externalId.slice(PAGE_PREFIX.length)}` : `urn:li:person:${externalId}`;
}

export class LinkedInError extends Error {
  constructor(message: string, public code = "platform_error") {
    super(message);
  }
}

type Http = typeof fetch;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(http: Http, url: string, token: string, what: string, versioned = true): Promise<Json> {
  const response = await http(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(versioned ? { "LinkedIn-Version": LINKEDIN_VERSION } : {}),
    },
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : undefined;
    throw new LinkedInError(`${what} failed${message ? `: ${message}` : ` (${response.status})`}.`, `http_${response.status}`);
  }
  return body;
}

// The largest picture LinkedIn offers in a "displayImage~" or "original~" projection.
function largestImage(decorated: Json | undefined): string | undefined {
  const elements = Array.isArray(decorated?.elements) ? (decorated!.elements as Json[]) : [];
  const best = elements.at(-1)?.identifiers?.[0]?.identifier;
  return typeof best === "string" && best.startsWith("https://") ? best : undefined;
}

export type LinkedInToken = { accessToken: string; refreshToken?: string; scopes: string[]; accessTokenExpiresAt?: Date; refreshTokenExpiresAt?: Date };

// The member's profile and the Pages they can post for, each as its own account.
export async function linkedinIdentities(token: LinkedInToken, capabilities: { profile: Capabilities; page: Capabilities }, http: Http = fetch): Promise<Identity[]> {
  const me = await get(
    http,
    "https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,vanityName,profilePicture(displayImage~:playableStreams))",
    token.accessToken,
    "Reading the LinkedIn profile",
    false,
  );
  // The member id posts are authored as (urn:li:person:{id}); the same as Sign In with
  // LinkedIn's "sub", so a profile connected through the original app is recognised.
  const memberId = typeof me.id === "string" ? me.id : "";
  if (!memberId) throw new LinkedInError("LinkedIn did not return a profile.");
  const shared = {
    ownerExternalId: memberId,
    scopes: token.scopes,
    tokens: { accessToken: token.accessToken, ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}) },
    accessTokenExpiresAt: token.accessTokenExpiresAt,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
  };
  const name = [me.localizedFirstName, me.localizedLastName].filter((part) => typeof part === "string" && part).join(" ").trim() || "LinkedIn member";
  const identities: Identity[] = [{
    ...shared,
    externalAccountId: memberId,
    // Profiles have no handle Post Social can show (handles.ts); the name stands in.
    handle: name,
    displayName: name,
    avatarUrl: largestImage(me.profilePicture?.["displayImage~"]),
    capabilities: capabilities.profile,
  }];

  const acls = await get(http, `${LINKEDIN_API}/organizationAcls?q=roleAssignee&state=APPROVED&count=${MAX_PAGES}`, token.accessToken, "Listing your LinkedIn Pages");
  const organizationIds = new Set<string>();
  for (const acl of Array.isArray(acls.elements) ? (acls.elements as Json[]) : []) {
    if (acl.state && acl.state !== "APPROVED") continue;
    if (!POSTING_ROLES.has(String(acl.role))) continue;
    const urn = String(acl.organization ?? acl.organizationTarget ?? "");
    const id = /^urn:li:organization:(\d+)$/.exec(urn)?.[1];
    if (id) organizationIds.add(id);
  }

  for (const id of organizationIds) {
    const page = await get(http, `${LINKEDIN_API}/organizations/${id}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`, token.accessToken, "Reading a LinkedIn Page")
      // A Page that can't be read is left out rather than failing the whole sign-in.
      .catch(() => null);
    if (!page) continue;
    const pageName = (typeof page.localizedName === "string" && page.localizedName.trim()) || `LinkedIn Page ${id}`;
    identities.push({
      ...shared,
      externalAccountId: linkedinPageExternalId(id),
      handle: typeof page.vanityName === "string" && page.vanityName ? page.vanityName : pageName,
      displayName: pageName,
      avatarUrl: largestImage(page.logoV2?.["original~"]),
      capabilities: capabilities.page,
    });
  }
  return identities;
}

// A Page's current name, public address and logo. LinkedIn lets apps keep a connected Page's
// profile for eight weeks, so it is read again every week (worker/src/avatars.ts).
export async function linkedinPageProfile(http: Http, token: string, externalId: string) {
  const id = externalId.slice(PAGE_PREFIX.length);
  const page = await get(http, `${LINKEDIN_API}/organizations/${id}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`, token, "Reading the LinkedIn Page");
  const name = typeof page.localizedName === "string" && page.localizedName.trim() ? page.localizedName.trim() : null;
  return { name, handle: typeof page.vanityName === "string" && page.vanityName ? page.vanityName : name, logo: largestImage(page.logoV2?.["original~"]) ?? null };
}
