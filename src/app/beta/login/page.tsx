import { AuthCard } from "../auth-card";
import { SignInForm } from "../forms";

export const metadata = { title: "Sign in · Post Social" };

export default async function BetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  return (
    <AuthCard
      title="Sign in to Post Social"
      intro="Post Social is invite-only for now. Use the email and password from your invitation."
    >
      <SignInForm
        next={next}
        notice={reset === "done" ? "Your password was changed. Sign in with the new one." : undefined}
      />
    </AuthCard>
  );
}
