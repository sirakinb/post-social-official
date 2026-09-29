import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { readMetaSignedRequest, verifyMetaSignedRequest } from "./lib/metaSignedRequest";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const metaDataDeletionHandler = httpAction(async (ctx, request) => {
  try {
    if (!process.env.META_APP_SECRET) return json({ error: "Meta deletion verification is not configured." }, 503);
    const signedRequest = await readMetaSignedRequest(request);
    const payload = await verifyMetaSignedRequest(signedRequest, process.env.META_APP_SECRET);
    if (!payload.user_id) return json({ error: "The deletion request did not include a user id." }, 400);
    const confirmationCode = `meta_${crypto.randomUUID().replaceAll("-", "")}`;
    await ctx.runMutation(internal.metaDeletion.process, { externalUserId: payload.user_id, externalUserHash: await sha256(payload.user_id), confirmationCode });
    const statusUrl = `${new URL(request.url).origin}/api/meta/data-deletion/status?code=${encodeURIComponent(confirmationCode)}`;
    return json({ url: statusUrl, confirmation_code: confirmationCode });
  } catch {
    return json({ error: "The signed deletion request could not be verified." }, 400);
  }
});

export const metaDeauthorizeHandler = httpAction(async (ctx, request) => {
  try {
    if (!process.env.META_APP_SECRET) return json({ error: "Meta deauthorization verification is not configured." }, 503);
    const signedRequest = await readMetaSignedRequest(request);
    const payload = await verifyMetaSignedRequest(signedRequest, process.env.META_APP_SECRET);
    if (!payload.user_id) return json({ error: "The deauthorization request did not include a user id." }, 400);
    const confirmationCode = `deauth_${crypto.randomUUID().replaceAll("-", "")}`;
    const result = await ctx.runMutation(internal.metaDeletion.process, {
      externalUserId: payload.user_id,
      externalUserHash: await sha256(payload.user_id),
      confirmationCode,
    });
    return json({ success: true, removed_accounts: result.removedAccounts });
  } catch {
    return json({ error: "The signed deauthorization request could not be verified." }, 400);
  }
});

export const metaDataDeletionStatusHandler = httpAction(async (ctx, request) => {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return json({ error: "A confirmation code is required." }, 400);
  const status = await ctx.runQuery(internal.metaDeletion.status, { confirmationCode: code });
  return status ? json(status) : json({ error: "Deletion request not found." }, 404);
});
