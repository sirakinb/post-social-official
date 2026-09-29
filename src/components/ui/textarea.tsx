import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[110px] w-full rounded-2xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink shadow-hairline transition-colors placeholder:text-ink-subtle focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-canvas-ivory disabled:text-ink-muted resize-y",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
