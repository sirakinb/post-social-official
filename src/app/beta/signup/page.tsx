import { notFound } from "next/navigation";
import { signupOpen } from "@/lib/insforge/auth-rules";
import { AuthCard } from "../auth-card";
import { GoogleButton, OrDivider, SignUpForm } from "../forms";

export const metadata = { title: "Start for free · Post Social" };

// Open sign-up. Off (PUBLIC_SIGNUP not "on"), the page does not exist.
export default async function BetaSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!signupOpen()) notFound();
  const { next } = await searchParams;
  return (
    <AuthCard title="Start for free" intro="Your first 2 social accounts are free. No card needed.">
      <GoogleButton next={next} />
      <OrDivider />
      <SignUpForm next={next} />
    </AuthCard>
  );
}
