// Alerts for the admin, never for users: an error in PostHog (the history) and, when an
// address and the Resend key are set, a short plain email (so it's actually seen). Never
// throws: an alert that fails must not stop the check that raised it.
import type { Telemetry } from "../../backend/lib/telemetry";

export const ALERT_FROM = "Post Social <alerts@postsocial.xyz>";

export type AlertConfig = {
  to: string | null; // ALERT_EMAIL: the admin address only
  resendKey: string | null;
  environment: string; // "production" or "dev"
  telemetry: Telemetry;
  http?: typeof fetch;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export function createAdminAlert(config: AlertConfig) {
  return async (subject: string, lines: string[]) => {
    const label = config.environment === "production" ? subject : `[Dev] ${subject}`;
    await config.telemetry.captureException(new Error(label), { area: "admin alert", details: lines.join("\n") });
    if (!config.to || !config.resendKey) {
      config.log?.("admin alert not emailed (ALERT_EMAIL or RESEND_API_KEY missing)", { subject: label });
      return;
    }
    try {
      const response = await (config.http ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: ALERT_FROM, to: [config.to], subject: label, text: lines.join("\n"), tags: [{ name: "type", value: "admin_alert" }] }),
      });
      if (!response.ok) config.log?.("admin alert email failed", { status: response.status });
    } catch (error) {
      config.log?.("admin alert email failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
