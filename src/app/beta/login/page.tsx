import { signupOpen } from "@/lib/insforge/auth-rules";
import { AuthCard } from "../auth-card";
import { GoogleButton, OrDivider, SignInForm } from "../forms";

export const metadata = { title: "Sign in · Post Social" };

export default async function BetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  const open = signupOpen();
  return (
    <AuthCard
      title="Sign in to Post Social"
      intro={open ? "Welcome back. Sign in with Google or your email and password." : "Post Social is invite-only for now. Use the email and password from your invitation."}
    >
      {open && (
        <>
          <GoogleButton next={next} />
          <OrDivider />
        </>
      )}
      <SignInForm
        next={next}
        signupLink={open}
        error={error === "google" ? "Signing in with Google didn't finish. Try again." : undefined}
        notice={reset === "done" ? "Your password was changed. Sign in with the new one." : undefined}
      />
    </AuthCard>
  );
}
