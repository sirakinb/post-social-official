"use node";

import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { openCredential, parseEncryptionKey, sealCredential } from "./lib/credentialCrypto";
import { assertPublicWebhookTarget, createWebhookSignature } from "./lib/webhookSecurity";

const webhookEvent = v.union(v.literal("destination.published"), v.literal("destination.failed"));

export const create = action({
  args: { workspaceId: v.id("workspaces"), url: v.string(), description: v.string(), events: v.array(webhookEvent) },
  handler: async (ctx, args): Promise<{ id: string; secret: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in is required.");
    const url = await assertPublicWebhookTarget(args.url);
    if (args.events.length === 0) throw new Error("Choose at least one webhook event.");
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const sealed = sealCredential({ accessToken: secret }, parseEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY));
    const id = await ctx.runMutation(internal.webhooks.store, {
      workspaceId: args.workspaceId,
      identitySubject: identity.tokenIdentifier,
      url: url.toString(),
      description: args.description.trim().slice(0, 100) || "Publishing webhook",
      events: args.events,
      secretHash: createHash("sha256").update(secret).digest("hex"),
      secretEncryptedPayload: sealed.encryptedPayload,
      secretInitializationVector: sealed.initializationVector,
    });
    return { id, secret };
  },
});

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const bundle = await ctx.runQuery(internal.webhooks.deliveryBundle, { deliveryId });
    if (!bundle) return;
    const secret = openCredential({ encryptedPayload: bundle.endpoint.secretEncryptedPayload, initializationVector: bundle.endpoint.secretInitializationVector }, parseEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY)).accessToken;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createWebhookSignature(secret, timestamp, bundle.delivery.payloadJson);
    let delivered = false; let statusCode: number | undefined; let error: string | undefined;
    try {
      const deliveryUrl = await assertPublicWebhookTarget(bundle.endpoint.url);
      const response = await fetch(deliveryUrl, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Post-Social-Webhooks/1.0", "x-post-social-event": bundle.delivery.event, "x-post-social-timestamp": timestamp, "x-post-social-signature": `v1=${signature}` }, body: bundle.delivery.payloadJson, signal: AbortSignal.timeout(10_000), redirect: "error" });
      statusCode = response.status; delivered = response.ok; if (!response.ok) error = `Endpoint returned HTTP ${response.status}.`;
    } catch (cause) { error = cause instanceof Error ? cause.message : "Webhook request failed."; }
    const retryAt = await ctx.runMutation(internal.webhooks.recordDelivery, { deliveryId, delivered, statusCode, error });
    if (retryAt) await ctx.scheduler.runAt(retryAt, internal.webhookActions.deliver, { deliveryId });
  },
});
