/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountLifecycle from "../accountLifecycle.js";
import type * as accounts from "../accounts.js";
import type * as apiKeys from "../apiKeys.js";
import type * as apiService from "../apiService.js";
import type * as auth from "../auth.js";
import type * as credentialVault from "../credentialVault.js";
import type * as credentials from "../credentials.js";
import type * as crons from "../crons.js";
import type * as developerHttp from "../developerHttp.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accountDeduplication from "../lib/accountDeduplication.js";
import type * as lib_captionEdit from "../lib/captionEdit.js";
import type * as lib_credentialCrypto from "../lib/credentialCrypto.js";
import type * as lib_destinationValidation from "../lib/destinationValidation.js";
import type * as lib_developerTools from "../lib/developerTools.js";
import type * as lib_mediaRemoval from "../lib/mediaRemoval.js";
import type * as lib_mediaService from "../lib/mediaService.js";
import type * as lib_metaSignedRequest from "../lib/metaSignedRequest.js";
import type * as lib_platformRevocation from "../lib/platformRevocation.js";
import type * as lib_platformRules from "../lib/platformRules.js";
import type * as lib_postFilters from "../lib/postFilters.js";
import type * as lib_postService from "../lib/postService.js";
import type * as lib_postState from "../lib/postState.js";
import type * as lib_publicErrors from "../lib/publicErrors.js";
import type * as lib_webhookSecurity from "../lib/webhookSecurity.js";
import type * as lib_youtubeService from "../lib/youtubeService.js";
import type * as maintenance from "../maintenance.js";
import type * as media from "../media.js";
import type * as metaDeletion from "../metaDeletion.js";
import type * as metaDeletionHttp from "../metaDeletionHttp.js";
import type * as model from "../model.js";
import type * as oauth from "../oauth.js";
import type * as oauthState from "../oauthState.js";
import type * as platformAccounts from "../platformAccounts.js";
import type * as posts from "../posts.js";
import type * as publishing from "../publishing.js";
import type * as publishingData from "../publishingData.js";
import type * as rateLimits from "../rateLimits.js";
import type * as tokenLifecycle from "../tokenLifecycle.js";
import type * as users from "../users.js";
import type * as webhookActions from "../webhookActions.js";
import type * as webhooks from "../webhooks.js";
import type * as workspaceLifecycle from "../workspaceLifecycle.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountLifecycle: typeof accountLifecycle;
  accounts: typeof accounts;
  apiKeys: typeof apiKeys;
  apiService: typeof apiService;
  auth: typeof auth;
  credentialVault: typeof credentialVault;
  credentials: typeof credentials;
  crons: typeof crons;
  developerHttp: typeof developerHttp;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/accountDeduplication": typeof lib_accountDeduplication;
  "lib/captionEdit": typeof lib_captionEdit;
  "lib/credentialCrypto": typeof lib_credentialCrypto;
  "lib/destinationValidation": typeof lib_destinationValidation;
  "lib/developerTools": typeof lib_developerTools;
  "lib/mediaRemoval": typeof lib_mediaRemoval;
  "lib/mediaService": typeof lib_mediaService;
  "lib/metaSignedRequest": typeof lib_metaSignedRequest;
  "lib/platformRevocation": typeof lib_platformRevocation;
  "lib/platformRules": typeof lib_platformRules;
  "lib/postFilters": typeof lib_postFilters;
  "lib/postService": typeof lib_postService;
  "lib/postState": typeof lib_postState;
  "lib/publicErrors": typeof lib_publicErrors;
  "lib/webhookSecurity": typeof lib_webhookSecurity;
  "lib/youtubeService": typeof lib_youtubeService;
  maintenance: typeof maintenance;
  media: typeof media;
  metaDeletion: typeof metaDeletion;
  metaDeletionHttp: typeof metaDeletionHttp;
  model: typeof model;
  oauth: typeof oauth;
  oauthState: typeof oauthState;
  platformAccounts: typeof platformAccounts;
  posts: typeof posts;
  publishing: typeof publishing;
  publishingData: typeof publishingData;
  rateLimits: typeof rateLimits;
  tokenLifecycle: typeof tokenLifecycle;
  users: typeof users;
  webhookActions: typeof webhookActions;
  webhooks: typeof webhooks;
  workspaceLifecycle: typeof workspaceLifecycle;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
