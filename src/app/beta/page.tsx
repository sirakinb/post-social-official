import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { signOut } from "./actions";

export const metadata = { title: "Post Social beta" };

type Membership = { role: string; workspaces: { name: string; slug: string } | null };

export default async function BetaHomePage() {
  // The proxy already redirects signed-out visitors; this guards against an expired or
  // revoked session that still has a cookie.
  const user = await currentUser();
  if (!user) redirect(BETA_LOGIN);

  const client = await insforgeServerClient();
  // Row-level security limits this to the person's own memberships and workspaces.
  const { data, error } = await client.database
    .from("workspace_members")
    .select("role, workspaces(name, slug)")
    .eq("user_id", user.id);
  const memberships = (data ?? []) as unknown as Membership[];

  return (
    <div className="technical-grid flex min-h-screen flex-col">
      <header className="border-b border-border bg-[#080610]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8">
          <Brand />
          <form action={signOut}><Button type="submit" variant="secondary">Sign out</Button></form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:px-8">
        <p className="utility-label text-accent">Post Social / Beta</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink">You are signed in</h1>
        <p className="mt-2 text-sm text-ink-muted">Signed in as <span className="text-ink">{user.email}</span>. The new web app is being built here; the current app stays at /app until launch.</p>
        <p className="mt-4 flex gap-6">
          <Link href="/beta/accounts" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Connected accounts →</Link>
          <Link href="/beta/media" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Media library →</Link>
          <Link href="/beta/usage" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Usage →</Link>
          <Link href="/beta/keys" className="text-sm font-medium text-accent underline-offset-4 hover:underline">API keys →</Link>
        </p>

        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Your workspaces</h2>
          {error ? (
            <p role="alert" className="mt-3 rounded-lg border border-error/20 bg-error-bg p-3 text-sm text-error">Your workspaces could not be loaded. Refresh the page to try again.</p>
          ) : memberships.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">You are not a member of any workspace yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {memberships.map((membership) => (
                <li key={membership.workspaces?.slug ?? membership.role} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-ink">{membership.workspaces?.name ?? "Unnamed workspace"}</span>
                  <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">{membership.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
