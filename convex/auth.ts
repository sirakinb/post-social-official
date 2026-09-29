import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

export function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: process.env.SITE_URL!,
    // The live site and local dev share this deployment, so the localhost
    // origins must be trusted alongside SITE_URL for local sign-in to work.
    trustedOrigins: [process.env.SITE_URL!, "http://localhost:3333", "http://127.0.0.1:3333"],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      // Accounts are provisioned through Pentridge Labs. Keep email/password
      // sign-in available for existing members and platform reviewers, but do
      // not allow anyone to create an account through the public auth API.
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      deleteUser: { enabled: true },
    },
    plugins: [convex({ authConfig })],
  });
}
