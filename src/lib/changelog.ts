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
    at: "2026-10-26T12:00:00-04:00",
    kind: "Improved",
    title: "Easier to connect Grok and Muse",
    body: "Grok can now sign in to Post Social from grok.com/connectors. Muse has a one-click Create a key for Muse button and a clearer setup message. Logs and Drafts now show Muse, Grok, Hermes and OpenClaw by name, and our connection address shows a short explainer if you open it in a browser.",
  },
  {
    at: "2026-10-20T20:30:00-04:00",
    kind: "New",
    title: "Billing",
    body: "Your first 2 accounts are free. After that it's usage based: you pay per connected account, from $5 down to $1 the more you connect. The new Billing page (under Settings) shows your next charge, your rate, your card and your receipts. X posts cost a few cents each, with a monthly limit you set.",
  },
  {
    at: "2026-10-20T20:30:00-04:00",
    kind: "New",
    title: "Anyone can sign up",
    body: "Post Social is open to everyone. Start for free with your email, no invite needed.",
  },
  {
    at: "2026-10-20T02:00:00-04:00",
    kind: "Fixed",
    title: "Scheduled posts show as published",
    body: "Scheduled posts went out on time but kept saying Scheduled afterwards, in the app and through the API. They now change to Published (or Partly published or Failed) once they go out, and earlier scheduled posts have been corrected.",
  },
  {
    at: "2026-10-20T01:00:00-04:00",
    kind: "Fixed",
    title: "TikTok links and stats",
    body: "New TikTok posts could get the wrong link, so View post didn't open them and Analytics thought they'd been deleted. Links are now right and their stats show. The one post this hit has been fixed. On Analytics, the accounts column that shows followers gained or lost is now called Follower change, and it says when counting started if that was under 30 days ago.",
  },
  {
    at: "2026-10-20T00:00:00-04:00",
    kind: "Improved",
    title: "Post from your phone",
    body: "Post Social now works better on a phone. iPhone videos (MOV) are turned into MP4 automatically, so they can go to Facebook Reels, LinkedIn and Bluesky too, and portrait phone videos count as portrait. Photos of any shape and format can go to Instagram: they're fitted to Instagram's 4:5 shape with a soft blurred backdrop. Uploads keep your screen awake and pause instead of starting over if your phone locks or the connection drops. The menu folds away on small screens, and you can add Post Social to your home screen. On Android you can share videos and photos straight into it; on iPhone, a Shortcut does the same. See On your phone in the menu.",
  },
  {
    at: "2026-10-17T03:30:00-04:00",
    kind: "Fixed",
    title: "TikTok post stats in Analytics",
    body: "TikTok often makes a post public a little after it's published, and TikTok drafts go public only when you post them from the app. Analytics now keeps checking until TikTok makes the post public, then shows its stats. Earlier TikTok posts that were missing stats are being checked again. Private posts have no public stats.",
  },
  {
    at: "2026-10-17T03:00:00-04:00",
    kind: "Fixed",
    title: "YouTube subscribers and engagement rate in Analytics",
    body: "Analytics now finds your YouTube channel from your published videos, so your subscriber count, growth and engagement rate fill in, and your channel's @handle shows on Accounts and Analytics. No need to reconnect.",
  },
  {
    at: "2026-10-16T15:00:00-04:00",
    kind: "New",
    title: "Analytics",
    body: "A new Analytics page shows how your posts and accounts are doing: engagement and views by week, each account's followers and growth, every post's likes, comments, shares and more (only the numbers each platform reports), the days and times your posts do best, which formats work, and how often to post. Numbers update on their own, and you can refresh them by hand up to 3 times a day.",
  },
  {
    at: "2026-10-15T09:00:00-04:00",
    kind: "Fixed",
    title: "AI apps no longer post right away when no time is given",
    body: 'A post made through the API or an AI app without a time is now saved as a draft instead of going out straight away, and the app is told it is a draft. To post right away, an app now has to ask for it with publish: "now"; scheduled times work as before. Unknown or misspelled fields (like scheduledAt) are now refused with an error instead of being ignored. If a tool or script of yours relied on "no time means post now", add publish: "now". Posting from the Post Social app works as before.',
  },
  {
    at: "2026-10-15T09:00:00-04:00",
    kind: "Improved",
    title: "Posts from the API show when they went out",
    body: "When an AI app or developer tool looks up your posts, each post now shows the time it was published, its live link on each account, and its pictures and videos, all in one place.",
  },
  {
    at: "2026-10-15T01:10:00-04:00",
    kind: "Improved",
    title: "Tell accounts with the same name apart",
    body: "When two of your accounts share a name, like an Instagram and a LinkedIn that both say \"Emmanuel Jones\", Accounts now shows each one's @handle and platform under its name. AI apps and the API also get the platform and @handle for every account a post goes to, so they can say exactly where it went.",
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
