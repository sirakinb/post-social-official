import { AuthCard } from "../auth-card";
import { SignInForm } from "../forms";

export const metadata = { title: "Sign in · Post Social beta" };

export default async function BetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  return (
    <AuthCard
      title="Sign in to the new Post Social"
      intro="This is the new version of Post Social, being built on a new backend. Accounts are created by invitation."
    >
      <SignInForm
        next={next}
        notice={reset === "done" ? "Your password was changed. Sign in with the new one." : undefined}
      />
    </AuthCard>
  );
}
