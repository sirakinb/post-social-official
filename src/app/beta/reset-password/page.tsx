import { AuthCard } from "../auth-card";
import { ResetPasswordForm } from "../forms";

export const metadata = { title: "Reset password · Post Social beta" };

export default function BetaResetPasswordPage() {
  return (
    <AuthCard title="Reset your password" intro="We will email you a one-time code to set a new password.">
      <ResetPasswordForm />
    </AuthCard>
  );
}
