import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { checkRequest, type AuthorizeParams } from "./actions";
import { ConsentForm } from "./consent-form";

export const metadata = { title: "Connect an app · Post Social" };

type Membership = { role: string; workspace_id: string; workspaces: { name: string } | null };

const CAN_DO = [
  "See your connected accounts, media and posts",
  "Upload media and write drafts",
  "Send and schedule posts. Accounts that need your approval still wait for you.",
  "Cancel or delete posts it can see",
];
const CANNOT_DO = ["Approve posts", "Connect or disconnect social accounts", "Create API keys or change settings"];

// The consent screen AI apps send people to (OAuth authorization endpoint).
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<AuthorizeParams> }) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) {
    const here = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`${BETA_LOGIN}?next=${encodeURIComponent(`/beta/authorize?${here}`)}`);
  }

  const check = await checkRequest(params);
  if (check.ok && "redirect" in check) redirect(check.redirect);

  const client = await insforgeServerClient();
  const { data } = await client.database.from("workspace_members").select("role, workspace_id, workspaces(name)").eq("user_id", user.id);
  const workspaces = ((data ?? []) as unknown as Membership[]).map((m) => ({ id: m.workspace_id, name: m.workspaces?.name ?? "Workspace", role: m.role }));

  return (
    <div className="technical-grid flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <Brand />
        {!check.ok ? (
          <>
            <h1 className="mt-6 text-xl font-semibold text-ink">This sign-in link can&apos;t be used</h1>
            <p role="alert" className="mt-2 text-sm text-ink-muted">{check.error}</p>
          </>
        ) : workspaces.length === 0 ? (
          <p className="mt-6 text-sm text-ink-muted">You are not a member of any workspace yet, so there is nothing to connect.</p>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-ink">Connect {check.client_name} to Post Social?</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Signed in as <span className="text-ink">{user.email}</span>. After you allow it, you&apos;ll go back to <span className="text-ink">{check.redirect_host}</span>.
            </p>
            <div className="mt-5 grid gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-ink">{check.client_name} will be able to</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">{CAN_DO.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink">It won&apos;t be able to</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">{CANNOT_DO.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            </div>
            <p className="mt-4 text-xs text-ink-subtle">Everything it does is labelled “{check.client_name}” in your activity. Disconnect it any time under API keys.</p>
            <ConsentForm params={params} clientName={check.client_name} workspaces={workspaces} />
          </>
        )}
      </div>
    </div>
  );
}
