import { Brand } from "@/components/brand";
import { UnsubscribeForm } from "./form";

export const metadata = { title: "Unsubscribe · Post Social", robots: { index: false, follow: false } };

// Where the link at the bottom of Post Social's tips emails lands.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const { u = "", t = "" } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <Brand className="mb-8" />
      <h1 className="text-2xl font-semibold text-ink">Unsubscribe from tips emails</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">These are the few emails Post Social sends to help you get started. Emails about your account and billing still come when needed.</p>
      {u && t ? <UnsubscribeForm u={u} t={t} /> : <p className="mt-6 text-sm text-ink-muted">This link is missing something. Use the link from the email, or write to support@postsocial.xyz.</p>}
    </div>
  );
}
