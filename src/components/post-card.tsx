import Link from "next/link";
import Image from "next/image";
import { Post } from "@/lib/types";
import { platformLabel, formatScheduled } from "@/lib/demo";
import { StatusIndicator } from "./status-indicator";
import { AccountAvatar } from "./account-avatar";
import { Card, CardContent } from "./ui/card";
import { cn } from "@/lib/utils";

interface PostCardProps {
  post: Post;
  accounts: { id: string; platform: "tiktok" | "instagram" | "facebook" | "threads" | "youtube"; handle: string; displayName: string; avatarUrl?: string }[];
  className?: string;
}

export function PostCard({ post, accounts, className }: PostCardProps) {
  const firstMedia = post.mediaUrl;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-0">
        <div className="flex items-start gap-4 p-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-canvas-ivory">
            {firstMedia ? (
              <Image
                src={firstMedia}
                alt=""
                width={64}
                height={64}
                className="h-full w-full rounded-lg object-cover"
                unoptimized
              />
            ) : (
              <span className="text-xs text-ink-subtle uppercase tracking-wide">
                {post.mediaType}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm text-ink">{post.caption}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusIndicator status={post.status} />
              {post.scheduledAt && (
                <span className="text-xs text-ink-muted">
                  {formatScheduled(post.scheduledAt)}
                </span>
              )}
              {post.publishedAt && (
                <span className="text-xs text-ink-muted">
                  {formatScheduled(post.publishedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-border bg-surface-raised px-5 py-3">
          <ul className="flex flex-col gap-2">
            {post.results.map((result) => {
              const account = accounts.find((a) => a.id === result.accountId);
              return (
                <li
                  key={result.accountId}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AccountAvatar
                      platform={result.platform}
                      src={account?.avatarUrl}
                      name={account?.displayName ?? platformLabel(result.platform)}
                      size="sm"
                    />
                    <span className="truncate text-sm text-ink">
                      {account?.handle ?? platformLabel(result.platform)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusIndicator
                      status={result.status}
                      label={result.statusText}
                    />
                    {result.liveUrl && (
                      <Link
                        href={result.liveUrl}
                        className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                      >
                        View
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {post.results.some((r) => r.errorDetail) && (
            <div className="mt-3 space-y-1">
              {post.results
                .filter((r): r is typeof r & { errorDetail: string } => Boolean(r.errorDetail))
                .map((r) => (
                  <p key={r.accountId} className="text-xs text-error">
                    {platformLabel(r.platform)}: {r.errorDetail}
                  </p>
                ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
