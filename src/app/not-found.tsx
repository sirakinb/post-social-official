import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <Brand className="mb-8" />
      <h1 className="font-display text-4xl font-semibold text-ink">404</h1>
      <p className="mt-2 text-ink-muted">
        This page does not exist.
      </p>
      <Button asChild variant="primary" className="mt-6">
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
