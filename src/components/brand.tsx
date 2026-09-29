import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BrandProps {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
  subtext?: ReactNode;
}

export function Brand({
  className,
  showWordmark = true,
  size = "md",
  subtext,
}: BrandProps) {
  const sizes = {
    sm: { mark: "text-2xl", text: "text-lg" },
    md: { mark: "text-3xl", text: "text-2xl" },
    lg: { mark: "text-5xl", text: "text-4xl" },
  };

  return (
    <Link
      href="/"
      className={cn(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md",
        subtext
          ? "inline-grid grid-cols-[auto_1fr] items-center gap-x-2.5"
          : "inline-flex items-center gap-2.5",
        className
      )}
      aria-label="Post Social home"
    >
      <span
        className={cn(
          "ps-mark text-current",
          subtext && "row-span-2",
          sizes[size].mark
        )}
        aria-hidden="true"
      >
        <span className="ps-mark__gate" />
        <span className="ps-mark__routes" />
        <span className="ps-mark__spark" />
      </span>
      {showWordmark && (
        <span
          className={cn(
            "font-sans font-semibold tracking-[-0.045em] text-current",
            subtext && "self-end",
            sizes[size].text
          )}
        >
          Post Social
        </span>
      )}
      {subtext && (
        <span className="self-start text-[10px] font-medium leading-none tracking-wide text-ink-subtle">
          {subtext}
        </span>
      )}
    </Link>
  );
}
