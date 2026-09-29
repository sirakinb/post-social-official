import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => {
    return (
      <span className="relative inline-flex h-5 w-5 shrink-0">
        <input
          type="checkbox"
          ref={ref}
          className={cn(
            "peer h-5 w-5 appearance-none rounded border border-border bg-surface shadow-hairline transition-colors checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-canvas-ivory",
            className
          )}
          {...props}
        />
        <Check
          className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
