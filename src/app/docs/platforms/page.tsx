import Link from "next/link";
import { PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: platforms · Post Social",
  description: "The eight platforms Post Social publishes to, what each can post and the limits Post Social checks before sending.",
};

// Limits are the ones Post Social checks before a post is sent (backend/lib/publishing/validate.ts)
// and the post types it offers (backend/lib/connections/platforms.ts).
type Platform = { id: string; name: string; posts: string; limits: string[]; connect?: string };

const PLATFORMS: Platform[] = [
  {
    id: "tiktok",
    name: "TikTok",
    posts: "Video, or photos (1 to 35 images as a swipeable carousel). Posts go direct, or to your TikTok inbox to finish there.",
    limits: [
      "Video captions up to 2,200 characters; photo captions up to 4,000, with an optional photo title of up to 90.",
      "Videos: MP4, MOV or WebM, at least 3 seconds. The longest allowed is your TikTok account's own maximum, checked before posting.",
      "Photos: JPEG, PNG or WebP.",
      "Direct posts need you to choose who can see the post: everyone, friends, followers, or only you.",
    ],
    connect: "Delivery is set per account: direct (the default) or Inbox first. An account set to Inbox first refuses direct posts.",
  },
  {
    id: "instagram",
    name: "Instagram",
    posts: "Image, Reel or carousel.",
    limits: [
      "Captions up to 2,200 characters.",
      "Reels: MP4 or MOV, 3 seconds to 15 minutes.",
      "Carousels: 2 to 10 files; videos in a carousel can be 3 to 60 seconds.",
    ],
    connect: "Needs a Business or Creator account.",
  },
  {
    id: "facebook",
    name: "Facebook Pages",
    posts: "Text, link, image, Reel or video, posted to a Page.",
    limits: [
      "Reels: MP4, vertical 9:16, 3 to 90 seconds.",
      "Videos: MP4 or MOV.",
      "Text and link posts cannot include media.",
    ],
    connect: "Connects Pages, not personal profiles. Choose at least one Page when Facebook asks.",
  },
  {
    id: "threads",
    name: "Threads",
    posts: "Text, image, video or carousel.",
    limits: [
      "Posts up to 500 characters.",
      "Images: JPEG or PNG. Videos: MP4 or MOV, up to 5 minutes.",
      "Carousels: 2 to 20 files.",
    ],
  },
  {
    id: "youtube",
    name: "YouTube",
    posts: "Shorts: one vertical or square video.",
    limits: [
      "Videos up to 3 minutes.",
      "A title is required, up to 100 characters. Descriptions up to 5,000 characters.",
      "You choose who can see it: public, unlisted or private.",
    ],
    connect: "The account shows as a YouTube channel, because the permission Post Social asks for covers uploading only.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    posts: "Text, image or video, posted to your own profile.",
    limits: [
      "Posts up to 3,000 characters.",
      "Images: 1 to 20 JPEG, PNG or GIF; two or more show as a gallery.",
      "Videos: one MP4, 3 seconds to 30 minutes, 75 KB to 500 MB.",
      "Visibility: public (the default) or connections only.",
    ],
  },
  {
    id: "bluesky",
    name: "Bluesky",
    posts: "Text, image or video.",
    limits: [
      "Posts up to 300 characters.",
      "Images: up to 4 JPEG, PNG, WebP or GIF, with a description for each. Larger images are resized to fit.",
      "Videos: one MP4, up to 3 minutes and 100 MB.",
      "Links, mentions and hashtags become clickable.",
    ],
    connect: "You enter your handle first, then sign in on Bluesky's own page.",
  },
  {
    id: "x",
    name: "X",
    posts: "Text, image or video.",
    limits: [
      "Posts up to 280 characters; a link counts as 23 and an emoji as 2.",
      "Images: up to 4 JPEG, PNG or WebP of up to 5 MB each, or one GIF of up to 15 MB.",
      "Videos: one MP4 or MOV, up to 2 minutes 20 seconds and 512 MB.",
    ],
    connect: "X posts are billed separately from accounts.",
  },
];

export default function PlatformsPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Platforms" title="Platforms">
        <p>
          Post Social publishes to eight platforms, each through its official sign-in. These are the post types and limits Post Social checks before it sends a post. Ask your AI to check a post first, and it
          reports any problem in plain words. The platforms can change their own rules, so a platform may still refuse a post that passes these checks.
        </p>
      </PageHeader>

      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Jump to a platform">
        {PLATFORMS.map((p) => (
          <li key={p.id}><a href={`#${p.id}`} className="lp-glass inline-flex h-8 items-center rounded-full px-3.5 text-xs text-ink-muted hover:text-ink">{p.name}</a></li>
        ))}
      </ul>

      {PLATFORMS.map((p) => (
        <Section key={p.id} id={p.id} title={p.name}>
          <p><span className="text-ink">What you can post.</span> {p.posts}</p>
          <ul className="list-disc space-y-1 pl-5">
            {p.limits.map((limit) => <li key={limit}>{limit}</li>)}
          </ul>
          {p.connect && (
            <p>
              <span className="text-ink">Connecting.</span> {p.connect}
              {p.id === "x" && <> See <Link href="/docs/billing#x" className="text-accent hover:underline">X posts in pricing and billing</Link>.</>}
            </p>
          )}
        </Section>
      ))}
    </div>
  );
}
