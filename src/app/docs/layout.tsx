import { DocsShell } from "@/components/docs/docs-shell";
import { PrimaryCta } from "@/components/landing/site-chrome";

// Every docs page shares one frame. The start button is made here because whether sign-up
// is open is read from the server's settings.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell cta={<PrimaryCta variant="compact" />}>{children}</DocsShell>;
}
