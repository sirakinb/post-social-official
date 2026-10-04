// InsForge clients for Server Components, Server Actions and Route Handlers. They read the
// signed-in person's session from cookies; the refresh token stays httpOnly.
import { cookies } from "next/headers";
import { createAuthActions, createServerClient } from "@insforge/sdk/ssr";

export async function insforgeServerClient() {
  return createServerClient({ cookies: await cookies() });
}

export async function insforgeAuthActions() {
  return createAuthActions({ cookies: await cookies() });
}

export async function currentUser() {
  const client = await insforgeServerClient();
  const { data } = await client.auth.getCurrentUser();
  return data?.user ?? null;
}
