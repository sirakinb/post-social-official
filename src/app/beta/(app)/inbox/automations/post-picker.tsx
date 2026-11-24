"use client";

import { useCallback, useEffect, useState } from "react";
import { PLATFORM_NAMES, Thumb } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { automationPosts, type AutomationPost } from "./actions";

const FORMAT: Record<AutomationPost["format"], string> = { video: "Video", carousel: "Carousel", photo: "Photo", text: "Text" };
const day = (iso: string) => {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

type State = { posts: AutomationPost[]; next: string | null; source: "live" | "saved"; status: "loading" | "ready" | "failed"; more: boolean };
const EMPTY: State = { posts: [], next: null, source: "live", status: "loading", more: false };

// Which post an automation answers comments on: every post, or one picked from the account's
// own posts (read from the platform, so posts made outside Post Social are there too).
export function PostPicker(props: {
  workspaceId: string;
  accountId: string;
  platform?: string;
  onePost: boolean;
  onOnePost: (one: boolean) => void;
  value: string;
  onChange: (platformPostId: string) => void;
  // How the posts are fetched (tests pass their own).
  loadPosts?: typeof automationPosts;
}) {
  const { workspaceId, accountId, value, onChange, onePost } = props;
  const fetchPosts = props.loadPosts ?? automationPosts;
  const [state, setState] = useState<State>(EMPTY);

  // The form remounts this picker (by key) when the account changes, so it always starts
  // empty and loading for the account it shows.
  type Result = Awaited<ReturnType<typeof automationPosts>>;
  const apply = useCallback((result: Result, cursor: string | null) => {
    if (!result.ok) return setState((s) => (cursor ? { ...s, more: false } : { ...EMPTY, status: "failed" }));
    setState((s) => {
      const have = new Set(cursor ? s.posts.map((p) => p.platform_post_id) : []);
      const added = result.data.posts.filter((p) => !have.has(p.platform_post_id));
      return { posts: cursor ? [...s.posts, ...added] : added, next: result.data.next_cursor, source: result.data.source, status: "ready", more: false };
    });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    void fetchPosts(workspaceId, accountId).then((result) => live && apply(result, null));
    return () => {
      live = false;
    };
  }, [workspaceId, accountId, apply, fetchPosts]);

  async function load(cursor: string | null) {
    setState((s) => (cursor ? { ...s, more: true } : EMPTY));
    apply(await fetchPosts(workspaceId, accountId, cursor), cursor);
  }

  const platform = PLATFORM_NAMES[props.platform ?? ""] ?? "the platform";
  const current = value && !state.posts.some((p) => p.platform_post_id === value);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="inline-flex self-start rounded-[9px] border border-ps-fg/[0.08] bg-ps-ground p-[3px]" role="radiogroup" aria-label="Which posts">
        {(
          [
            [false, "Every post"],
            [true, "One post"],
          ] as const
        ).map(([one, text]) => (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={onePost === one}
            onClick={() => (props.onOnePost(one), one || onChange(""))}
            className={cn("h-7 rounded-md px-3 text-xs", onePost === one ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}
          >
            {text}
          </button>
        ))}
      </div>

      {!onePost ? (
        <p className="m-0 text-xs text-ps-subtle">Answers comments on every post on this account, including ones you publish later.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-ps-line-strong bg-ps-ground">
            <div role="radiogroup" aria-label="Post" className="max-h-[336px] overflow-y-auto">
              {current && <Row selected caption="The post this automation is on now" detail="Not in the list below" thumbnail={null} video={false} onPick={() => undefined} />}
              {state.status === "loading" &&
                [0, 1, 2, 3].map((i) => (
                  <div key={i} aria-hidden="true" className="flex items-center gap-3 border-b border-ps-line px-3 py-2.5 last:border-0">
                    <span className="h-10 w-10 flex-none animate-pulse rounded-lg bg-ps-segment" />
                    <span className="flex flex-1 flex-col gap-1.5">
                      <span className="h-3 w-3/5 animate-pulse rounded bg-ps-segment" />
                      <span className="h-2.5 w-1/4 animate-pulse rounded bg-ps-segment" />
                    </span>
                  </div>
                ))}
              {state.status === "failed" && (
                <div className="flex items-center justify-between gap-3 px-3 py-4 text-xs text-ps-muted">
                  The posts didn&rsquo;t load.
                  <button type="button" onClick={() => void load(null)} className="text-ps-plum hover:underline">Try again</button>
                </div>
              )}
              {state.status === "ready" && state.posts.length === 0 && !current && (
                <div className="px-3 py-4 text-xs text-ps-muted">No posts on this account yet. Choose Every post to answer the ones you publish later.</div>
              )}
              {state.posts.map((p) => (
                <Row
                  key={p.platform_post_id}
                  selected={p.platform_post_id === value}
                  caption={p.caption ?? "No caption"}
                  detail={`${day(p.published_at)} · ${FORMAT[p.format]}`}
                  thumbnail={p.thumbnail_url}
                  video={p.format === "video"}
                  onPick={() => onChange(p.platform_post_id)}
                />
              ))}
            </div>
            {state.status === "ready" && state.next && (
              <button type="button" disabled={state.more} onClick={() => void load(state.next)} className="h-9 w-full border-t border-ps-line text-xs text-ps-muted hover:text-ps-text disabled:opacity-60">
                {state.more ? "Loading…" : "Show older posts"}
              </button>
            )}
          </div>
          <p className="m-0 text-xs text-ps-subtle">
            {state.status === "ready" && state.source === "saved"
              ? `${platform} couldn’t be reached just now, so this is the posts we have saved.`
              : `Every post on this account, straight from ${platform}, including ones made outside Post Social.`}
          </p>
        </>
      )}
    </div>
  );
}

function Row(props: { selected: boolean; caption: string; detail: string; thumbnail: string | null; video: boolean; onPick: () => void }) {
  return (
    <div className="border-b border-ps-line last:border-0">
      <button
        type="button"
        role="radio"
        aria-checked={props.selected}
        aria-label={`${props.caption}, ${props.detail}`}
        onClick={props.onPick}
        className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-ps-fg/[0.03]", props.selected && "bg-ps-plum/[0.08] hover:bg-ps-plum/[0.08]")}
      >
        <Thumb url={props.thumbnail} isVideo={props.video} size={40} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] text-ps-text">{props.caption}</span>
          <span className="text-xs text-ps-subtle">{props.detail}</span>
        </span>
        <span aria-hidden="true" className={cn("flex h-4 w-4 flex-none items-center justify-center rounded-full border", props.selected ? "border-ps-plum bg-ps-plum" : "border-ps-line-strong")}>
          {props.selected && <span className="h-1.5 w-1.5 rounded-full bg-ps-ground" />}
        </span>
      </button>
    </div>
  );
}
