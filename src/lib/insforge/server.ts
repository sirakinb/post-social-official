// InsForge clients for Server Components, Server Actions and Route Handlers. They read the
// signed-in person's session from cookies; the refresh token stays httpOnly.
//
// `currentUser` answers for whichever sign-in this environment uses (src/lib/sign-in/rules.ts),
// in the shape InsForge gives, so the pages that call it don't change.
import { cache } from "react";
import { cookies } from "next/headers";
import { createAuthActions, createServerClient } from "@insforge/sdk/ssr";
import { ownCurrentUser } from "@/lib/sign-in/ours";
import { ownSignInUrl } from "@/lib/sign-in/rules";

export async function insforgeServerClient() {
  return createServerClient({ cookies: await cookies() });
}

export async function insforgeAuthActions() {
  return createAuthActions({ cookies: await cookies() });
}

export type CurrentUser = { id: string; email: string; profile?: { name?: string; avatar_url?: string } | null };

// With our own sign-in this asks the API, so it is remembered for the length of one page
// render: a layout and its page share one answer.
const ownUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await ownCurrentUser();
  return user ? { id: user.id, email: user.email, profile: { name: user.name ?? undefined, avatar_url: user.image ?? undefined } } : null;
});

export async function currentUser(): Promise<CurrentUser | null> {
  if (ownSignInUrl()) return ownUser();
  const client = await insforgeServerClient();
  const { data } = await client.auth.getCurrentUser();
  return (data?.user as CurrentUser | undefined) ?? null;
}
