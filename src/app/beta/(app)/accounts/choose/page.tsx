import Link from "next/link";
import { cookies } from "next/headers";
import { Card, CardHeader, PLATFORM_NAMES, PlatformMark } from "@/components/beta/ui";
import { Button } from "@/components/ui/button";
import { FLASH_COOKIE, readFlash } from "@/lib/beta/flash";
import { loadViewer } from "@/lib/beta/workspace";
import { chooseAccounts, loadPendingChoices } from "../actions";

export const metadata = { title: "Choose accounts · Post Social" };

const KIND = { profile: "Your profile", page: "Company Page" } as const;
// What each choice is, under its name: LinkedIn says profile or Company Page; Facebook
// choices are always Pages.
const kindLabel = (platform: string, kind: keyof typeof KIND | null, name: string) =>
  kind ? KIND[kind] : platform === "facebook" ? "Facebook Page" : name;

// After a sign-in that brought several new accounts (a LinkedIn profile and the Pages its
// member can post for, or Facebook Pages the person shared with Post Social at any time),
// the person ticks the ones to add. Each added account is billed, so
// nothing new is connected without a tick. Accounts already connected were refreshed already.
export default async function ChooseAccountsPage({ searchParams }: { searchParams: Promise<{ pending?: string; workspace?: string }> }) {
  const { pending: pendingId = "" } = await searchParams;
  const { workspace } = await loadViewer("/beta/accounts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const back = `/beta/accounts?workspace=${encodeURIComponent(workspace.slug)}`;
  const pending = /^[0-9a-f-]{36}$/i.test(pendingId) ? await loadPendingChoices(pendingId) : null;
  if (!pending?.ok) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <p className="text-sm text-ps-muted">{pending && !pending.ok ? pending.error : "This sign-in expired. Connect the account again."}</p>
        <Link href={back} className="mt-3 inline-block text-sm text-ps-accent hover:underline">Back to accounts</Link>
      </div>
    );
  }
  const { platform, choices } = pending.data;
  const name = PLATFORM_NAMES[platform] ?? platform;
  const notice = readFlash((await cookies()).get(FLASH_COOKIE)?.value, "notice");

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="m-0 text-lg font-medium text-ps-text">Choose {name} accounts</h1>
      <p className="mt-1 text-sm text-ps-muted">Tick the accounts to add. Each one you add counts as a connected account on your plan.</p>
      {notice ? <p className="mt-3 text-sm text-ps-muted">{notice}</p> : null}
      <form action={chooseAccounts} className="mt-5">
        <input type="hidden" name="pending_id" value={pendingId} />
        <Card>
          <CardHeader title={`${choices.length} accounts found`} />
          <ul className="m-0 list-none divide-y divide-ps-fg/[0.06] p-0">
            {choices.map((choice) => (
              <li key={choice.external_id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <input type="checkbox" name="external_id" value={choice.external_id} className="h-4 w-4 accent-ps-accent" />
                  {/* Platform pictures are copied to our storage once an account is connected; until then the logo stands in. */}
                  <PlatformMark platform={platform} size={32} className="rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ps-text">{choice.name}</span>
                    <span className="block text-xs text-ps-subtle">{kindLabel(platform, choice.kind, name)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit">Add selected</Button>
          <Link href={back} className="text-sm text-ps-muted hover:text-ps-text">Skip for now</Link>
        </div>
      </form>
    </div>
  );
}
