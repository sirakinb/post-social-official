// What changed in Post Social, newest first. Shown at /changelog.
// To add a release, put a new entry at the top: plain words a customer would
// understand, the time it shipped (with its UTC offset), and one kind.

export type ChangelogKind = "New" | "Improved" | "Fixed";

export type ChangelogEntry = {
  /** When it shipped, ISO 8601 with offset, e.g. "2026-10-13T13:06:00-04:00". */
  at: string;
  kind: ChangelogKind;
  title: string;
  body: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    at: "2026-10-15T09:00:00-04:00",
    kind: "Improved",
    title: "Posts from the API show when they went out",
    body: "When an AI app or developer tool looks up your posts, each post now shows the time it was published, its live link on each account, and its pictures and videos, all in one place.",
  },
  {
    at: "2026-10-13T23:55:00-04:00",
    kind: "New",
    title: "Light mode",
    body: "The app now has a light mode. Use the sun and moon switch at the top right of any page to change between light and dark; your choice is remembered.",
  },
  {
    at: "2026-10-13T13:06:00-04:00",
    kind: "Improved",
    title: "Every AI-made post names its app",
    body: "Logs now show which AI app made each post, including posts from apps you connected before we started recording app names.",
  },
  {
    at: "2026-10-13T11:07:00-04:00",
    kind: "New",
    title: "AI apps can post straight to TikTok",
    body: "Posts your AI apps make for TikTok now go live directly by default. Each TikTok account has an \"AI posts\" setting in Accounts if you would rather have them land in your TikTok inbox first.",
  },
  {
    at: "2026-10-13T07:17:00-04:00",
    kind: "New",
    title: "TikTok Direct Post",
    body: "TikTok approved Post Social for direct posting, so TikTok posts now publish to your profile instead of waiting in your TikTok drafts.",
  },
  {
    at: "2026-10-13T00:51:00-04:00",
    kind: "New",
    title: "Drafts page",
    body: "A new Drafts page in the sidebar lists every draft, including ones saved by your AI apps. Open one to keep editing in Create, or delete it.",
  },
  {
    at: "2026-10-11T16:42:00-04:00",
    kind: "New",
    title: "Closed beta",
    body: "Invited testers now get a welcome email with everything they need to sign in. Questions go to support@postsocial.xyz.",
  },
  {
    at: "2026-10-10T20:34:00-04:00",
    kind: "Improved",
    title: "Clearer Logs and error messages",
    body: "Logs show which AI app made a post, with its logo, and the filters sit in one tidy toolbar. Errors you can't fix yourself now point you to support. The API & MCP page has setup steps for Codex, Cursor, Grok and more.",
  },
  {
    at: "2026-10-10T12:18:00-04:00",
    kind: "New",
    title: "X (Twitter)",
    body: "Connect your X account and post text, images and videos. Post Social now publishes to eight platforms.",
  },
  {
    at: "2026-10-10T10:06:00-04:00",
    kind: "New",
    title: "Bluesky",
    body: "Connect Bluesky with its official sign-in and post text, images and videos.",
  },
  {
    at: "2026-10-10T06:07:00-04:00",
    kind: "New",
    title: "LinkedIn",
    body: "Connect your LinkedIn profile and post text, images and videos.",
  },
  {
    at: "2026-10-07T09:50:00-04:00",
    kind: "New",
    title: "Video covers",
    body: "Choose a cover for each video, from your media library or a frame of the video, with the right option for each platform.",
  },
  {
    at: "2026-10-06T16:35:00-04:00",
    kind: "Fixed",
    title: "Large TikTok videos upload reliably",
    body: "Big video files are now split the way TikTok expects, so they no longer fail partway through.",
  },
  {
    at: "2026-10-06T01:44:00-04:00",
    kind: "New",
    title: "TikTok photo posts",
    body: "Post photo carousels of 1 to 35 images to TikTok, with plain-language explanations when TikTok limits a post.",
  },
  {
    at: "2026-10-05T14:18:00-04:00",
    kind: "Improved",
    title: "Reliability and privacy",
    body: "Uploads and publishing recover on their own after interruptions, and error reports no longer include personal details.",
  },
  {
    at: "2026-10-05T10:02:00-04:00",
    kind: "New",
    title: "New website and waitlist",
    body: "postsocial.xyz launched with a look at the app and a waitlist for early access.",
  },
  {
    at: "2026-10-05T02:30:00-04:00",
    kind: "New",
    title: "The Post Social web app",
    body: "Home, Create, Calendar, Media library, Activity and Accounts, all in one place to plan and publish your posts.",
  },
  {
    at: "2026-10-04T22:42:00-04:00",
    kind: "New",
    title: "Command line tool, Claude Code plugin and docs",
    body: "Schedule posts from your terminal or from Claude Code, with full docs for the API and MCP server.",
  },
  {
    at: "2026-10-04T20:51:00-04:00",
    kind: "New",
    title: "API and MCP server for AI apps",
    body: "Let ChatGPT, Claude and other AI apps draft and schedule posts for you. They sign in with your approval and never see your social passwords.",
  },
  {
    at: "2026-10-04T18:17:00-04:00",
    kind: "New",
    title: "Scheduling and publishing",
    body: "Connect TikTok, Instagram, Facebook Pages, Threads and YouTube, and schedule posts to all of them at once.",
  },
];
