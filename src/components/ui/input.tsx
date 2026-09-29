import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-2xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink shadow-hairline transition-colors placeholder:text-ink-subtle focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-canvas-ivory disabled:text-ink-muted",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
