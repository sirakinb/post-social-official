import * as React from "react";
import { cn } from "@/lib/utils";

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        className={cn(
          "relative inline-flex h-6 w-11 cursor-pointer items-center",
          className
        )}
      >
        <input
          type="checkbox"
          ref={ref}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "h-6 w-11 rounded-full border border-border bg-canvas-ivory transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          )}
        />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform peer-checked:translate-x-5" />
      </label>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
