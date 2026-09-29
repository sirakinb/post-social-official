import { cn } from "@/lib/utils";

interface EmptyProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function Empty({ title, description, action, className }: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-10 text-center",
        className
      )}
    >
      <p className="font-display text-lg font-medium text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
