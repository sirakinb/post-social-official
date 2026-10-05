import { AppShell } from "@/components/app-shell";
import { AuthenticatedApp } from "@/components/authenticated-app";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  // data-ph-mask: session replays hide this app's text and pictures (instrumentation-client.ts).
  return <div data-ph-mask><AuthenticatedApp><AppShell>{children}</AppShell></AuthenticatedApp></div>;
}
