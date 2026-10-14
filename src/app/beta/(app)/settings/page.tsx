import Link from "next/link";
import { ActorMark } from "@/components/beta/marks";
import { Card, CardHeader } from "@/components/beta/ui";
import { loadViewer } from "@/lib/beta/workspace";
import { signOut } from "../../actions";

export const metadata = { title: "Settings · Post Social" };

// The address the privacy policy gives for account and data deletion.
const DELETION_EMAIL = "support@postsocial.xyz";

const ROLE: Record<string, string> = {
  owner: "Owner: full control",
  admin: "Admin: accounts, posts and API keys",
  member: "Member: connect accounts and post",
  reviewer: "Reviewer: reviews posts, can't post or connect accounts",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ps-fg/[0.05] px-4 py-3 last:border-b-0">
      <span className="w-40 flex-none text-ps-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const { viewer, workspace } = await loadViewer("/beta/settings");

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6 px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Settings</h1>
        <p className="mt-1 text-ps-muted">Your sign-in and your workspace.</p>
      </div>

      <Card aria-label="Your account">
        <CardHeader title="Your account" />
        <div className="flex items-center gap-3 border-b border-ps-fg/[0.05] px-4 py-3.5">
          <ActorMark kind="user" name={viewer.name} avatarUrl={viewer.avatarUrl} size={36} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm">{viewer.name}</span>
            <span className="truncate text-xs text-ps-subtle">{viewer.email}</span>
          </span>
        </div>
        <Row label="Password">
          <Link href="/beta/reset-password" className="text-ps-plum-soft hover:text-ps-text">Change password</Link>
          <span className="ml-2 text-xs text-ps-subtle">We email you a one-time code.</span>
        </Row>
        <Row label="Session">
          <form action={signOut}>
            <button type="submit" className="inline-flex h-[30px] items-center rounded-lg border border-ps-fg/[0.12] px-3 text-xs hover:border-ps-fg/25">Sign out</button>
          </form>
        </Row>
      </Card>

      {workspace && (
        <Card aria-label="Workspace">
          <CardHeader title="Workspace" />
          <Row label="Name">{workspace.name}</Row>
          <Row label="Your role">{ROLE[workspace.role] ?? workspace.role}</Row>
        </Card>
      )}

      <Card aria-label="Delete account" className="border-ps-failed/25">
        <CardHeader title="Delete account" />
        <p className="m-0 px-4 py-3.5 leading-relaxed text-ps-muted">
          To delete your account, your connected accounts and everything Post Social stored for you, email <span className="select-all text-ps-text">{DELETION_EMAIL}</span> from the address you sign in with. See the <Link href="/privacy" className="text-ps-plum-soft hover:text-ps-text">privacy policy</Link>.
        </p>
      </Card>
    </div>
  );
}
