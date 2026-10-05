// Errors while rendering a page or running a server action, reported to PostHog (server
// side). The browser reports its own errors (instrumentation-client.ts).
import type { Instrumentation } from "next";
import { createTelemetry } from "../backend/lib/telemetry";

const telemetry = createTelemetry({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, service: "web", environment: process.env.VERCEL_ENV ?? "development" });

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await telemetry.captureException(error, { area: "web server", path: request.path.split("?")[0], method: request.method, route: context.routePath, kind: context.routeType });
};
