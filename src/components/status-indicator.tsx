import { CheckCircle2, Clock, AlertCircle, Loader2, Circle } from "lucide-react";
import { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  status: PostStatus;
  label?: string;
  className?: string;
}

export function StatusIndicator({
  status,
  label,
  className,
}: StatusIndicatorProps) {
  const configs: Record<
    PostStatus,
    { icon: React.ReactNode; text: string; colorClass: string }
  > = {
    draft: {
      icon: <Circle className="h-4 w-4" />,
      text: label ?? "Draft",
      colorClass: "text-ink-muted",
    },
    scheduled: {
      icon: <Clock className="h-4 w-4" />,
      text: label ?? "Scheduled",
      colorClass: "text-info",
    },
    processing: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      text: label ?? "Processing",
      colorClass: "text-accent",
    },
    published: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      text: label ?? "Published",
      colorClass: "text-success",
    },
    failed: {
      icon: <AlertCircle className="h-4 w-4" />,
      text: label ?? "Failed",
      colorClass: "text-error",
    },
    partial: {
      icon: <AlertCircle className="h-4 w-4" />,
      text: label ?? "Partially published",
      colorClass: "text-warning",
    },
  };

  const config = configs[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        config.colorClass,
        className
      )}
    >
      {config.icon}
      <span>{config.text}</span>
    </span>
  );
}
