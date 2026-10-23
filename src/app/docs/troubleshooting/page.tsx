import Link from "next/link";
import { PageHeader, Section } from "@/components/docs/parts";

export const metadata = {
  title: "Docs: troubleshooting and error reference · Post Social",
  description: "Plain-language reasons a post or account fails, what each one means and how to fix it, plus the API error codes.",
};

// Every message here comes from the code that produces it: the pre-send checks
// (backend/lib/publishing/validate.ts), the publishing worker (worker/src/publish), the
// connection flow and the REST API. Where a message includes a name or number, it is shown as <...>.
type Row = { sees: string; fix: string };

const RECONNECT: Row[] = [
  { sees: "“… was refused because the <platform> access expired. Reconnect <platform> and try again.”", fix: "The platform no longer accepts Post Social’s access. On the Accounts page choose Reconnect and sign in again." },
  { sees: "“<account> was disconnected. Reconnect it to publish.”", fix: "The account was disconnected. Connect it again from the Accounts page." },
  { sees: "“… was refused by LinkedIn … Reconnect LinkedIn to grant posting access.”", fix: "LinkedIn did not allow posting. Reconnect LinkedIn and approve posting when it asks." },
  { sees: "“Reconnect this TikTok account to allow sending drafts.”", fix: "The TikTok connection is missing the permission to send drafts. Reconnect TikTok." },
  { sees: "The account shows Needs attention on the Accounts page", fix: "Choose Reconnect on that account." },
];

const CONNECTING: Row[] = [
  { sees: "“Instagram did not return a professional account. Switch the account to Business or Creator and try again.”", fix: "Change the Instagram account to a Business or Creator account in Instagram, then connect again." },
  { sees: "“Meta connected but shared no Facebook Pages. Reconnect and choose at least one Page in Edit settings.”", fix: "Connect again and choose at least one Page when Facebook asks." },
  { sees: "“Meta returned <n> Facebook Page(s), but none allow posting. Reconnect and give Post Social access to manage a Page.”", fix: "Connect again and give Post Social access to manage a Page." },
  { sees: "“Google did not return lasting access. Remove Post Social at myaccount.google.com/permissions, then connect again.”", fix: "Remove Post Social from your Google account’s permissions, then connect YouTube again." },
  { sees: "“Bluesky sign-in could not start. Try again.”", fix: "Check the handle you entered (for example name.bsky.social) and try again." },
  { sees: "“Accounts are connected by a person in the Post Social web app. Use a connect link.”", fix: "An AI can’t connect accounts. Ask it for a connect link and open it yourself." },
];

const BEFORE_SENDING: Row[] = [
  { sees: "“<Platform> posts can be at most <n> characters; this one is <m>.”", fix: "Shorten the text. Ask your AI to write a shorter version for that platform. Limits are on the Platforms page; on X, links count as 23 and emoji as 2." },
  { sees: "“<file> is still being checked; only ready media can be posted.”", fix: "The file is still processing. Wait a moment and try again. If it says failed, upload it again." },
  { sees: "“<Platform> … must be <type>; <file> is <type>.”", fix: "The file type isn’t accepted for that kind of post. Convert it (for example to MP4 or JPEG) and upload it again." },
  { sees: "“… must be at least <n> seconds” or “… can be at most <n>; <file> is <m>.”", fix: "The video is too short or too long for that platform. Trim it, or post it to a different platform." },
  { sees: "“Facebook Reels must be vertical 9:16” or “YouTube Shorts must be vertical or square”", fix: "Re-export the video in a vertical (or, for YouTube, square) shape." },
  { sees: "“A <platform> <post type> needs exactly 1 video” or “… needs 2 to <n> files”", fix: "The number of files doesn’t match the post type. Attach the right number of files." },
  { sees: "“Choose an Instagram post type” / “Choose a Facebook post type” / “Choose a Threads post type”", fix: "Say what kind of post it is: image, Reel or carousel on Instagram; text, link, image, Reel or video on Facebook; text, image, video or carousel on Threads." },
  { sees: "“Add a title for the YouTube Short.” or “Choose who can see the YouTube Short”", fix: "YouTube needs a title (up to 100 characters) and a visibility: public, unlisted or private." },
  { sees: "“Choose who can see this TikTok: everyone, friends, followers or only you.”", fix: "TikTok direct posts need an audience. Tell your AI who should see it, or set the account to Inbox first." },
  { sees: "“Branded content on TikTok cannot be private …”", fix: "Choose a wider audience, or turn off branded content." },
  { sees: "“Duet and Stitch aren’t available for TikTok photo posts”", fix: "Turn Duet and Stitch off for photo posts." },
  { sees: "“A Facebook text post cannot include media” (and the same for link, Threads text, LinkedIn text, Bluesky text and X text posts)", fix: "Text-only posts can’t have files. Choose an image or video post type, or remove the media." },
  { sees: "“The scheduled time is in the past.” / “Posts can be scheduled up to a year ahead.”", fix: "Give a time from now up to a year ahead, with a time zone." },
  { sees: "“A post can go to at most 20 accounts.” / “A post can include at most 35 media files.”", fix: "Split the post into more than one." },
  { sees: "“One of the chosen accounts is not connected to this workspace.” / “<account> is listed twice.”", fix: "Check the account list from list_social_accounts and use each account once." },
];

const WAITING: Row[] = [
  { sees: "“… limit for this account is used up for now. Post Social will try again later.” (Bluesky, LinkedIn, X)", fix: "The platform is limiting that account. Nothing to do: Post Social retries on its own." },
  { sees: "“This Bluesky account has reached its daily video upload limit. Post Social will try again later.”", fix: "Nothing to do. It retries later." },
  { sees: "“YouTube’s daily upload limit is used up … after it resets at midnight Pacific time.”", fix: "Nothing to do. It retries after the reset." },
  { sees: "“This account reached its safe posting limit for now; it will go out when the limit resets.”", fix: "Nothing to do. The post goes out when the limit resets." },
  { sees: "“TikTok says this account can’t post right now (often a daily limit). Try again later.”", fix: "Wait and post again later." },
  { sees: "“TikTok says this account has posted too much today. Try again tomorrow.”", fix: "Post again tomorrow." },
  { sees: "“TikTok’s daily limit for this app has been reached. Try again tomorrow.”", fix: "Post again tomorrow." },
  { sees: "“TikTok has several Post Social drafts waiting in this account’s inbox. Open TikTok to post or delete them, then try again.”", fix: "Clear the drafts in TikTok, then post again." },
  { sees: "“TikTok has blocked this account from posting right now.”", fix: "This is TikTok’s decision about the account. Check the account in TikTok." },
  { sees: "“TikTok hasn’t cleared this Post Social app to post publicly, so it can only post to TikTok accounts set to Private …”", fix: "Make the TikTok account private, or send the post as a draft to your TikTok inbox." },
  { sees: "“This TikTok account can’t post with that audience. Choose one of: …” or “That audience isn’t available for this TikTok account.”", fix: "Choose one of the audiences listed." },
  { sees: "“This TikTok account allows videos up to <n> seconds; this one is <m>.”", fix: "Trim the video to the length TikTok allows for that account." },
  { sees: "“Comments / Duet / Stitch is turned off for this TikTok account; turn it off for this post.”", fix: "Turn that option off for the post, or turn it on in TikTok." },
];

const BILLING: Row[] = [
  { sees: "“This workspace reached its monthly X limit, so this post didn’t go out. Raise the X cap on the Billing page (or add a card), then post it again. Other platforms are not affected.”", fix: "Raise the X cap or add a card on the Billing page, then post again. See X posts in pricing and billing." },
  { sees: "“This workspace has <n> connected accounts and the <plan> plan covers <m>, so posting is paused. Add a card on the Billing page, or disconnect accounts, then post again.”", fix: "Add a card on the Billing page, or disconnect accounts until you’re within the plan." },
  { sees: "“Your <plan> plan allows <n> … limit.” (status 402)", fix: "You have reached a plan limit, such as published posts in a month. See Rate limits and status." },
  { sees: "“Your <plan> plan allows <n> API calls a day, and today’s are used up. Calls work again after midnight UTC.” (status 429)", fix: "Wait until after midnight UTC." },
];

const UNSURE: Row[] = [
  { sees: "“… was interrupted … Check the <platform> before posting it again.”", fix: "The post may have gone out. Look at the account on the platform first, so you don’t post it twice." },
  { sees: "“The platform has not confirmed the post after 30 minutes. Check the platform before posting again.”", fix: "The same: check the platform first." },
  { sees: "“The photos may already be on TikTok … Check your TikTok profile before posting again.”", fix: "The same: check your TikTok profile first." },
];

const PROCESSING: Row[] = [
  { sees: "“<Platform> could not process the video / images / media …”", fix: "The platform rejected the file after upload. Re-export the file and post again." },
  { sees: "“One of the images could not be made small enough for Bluesky (1 MB).”", fix: "Use a smaller or simpler image." },
  { sees: "“The stored media could not be read.” (Post Social retries this itself)", fix: "If it keeps failing, upload the file again." },
];

const SUPPORT: Row[] = [
  { sees: "“Something went wrong on Post Social’s side while publishing. Contact support and we’ll get it posted.”", fix: "Email support@postsocial.xyz. It isn’t something you can fix." },
  { sees: "“X posting is temporarily unavailable on Post Social’s side … Nothing is wrong with your account.”", fix: "Email support@postsocial.xyz. The post didn’t go out." },
  { sees: "“Something went wrong on our side. Try again in a moment.” (API status 500)", fix: "Try again in a moment. If it keeps happening, email support@postsocial.xyz." },
];

const API_CODES: { status: string; code: string; meaning: string }[] = [
  { status: "400", code: "invalid_request", meaning: "The request has a problem, such as a missing or unknown field, or a post that breaks a platform’s rules. The message says which." },
  { status: "401", code: "unauthorized", meaning: "No valid key or sign-in was sent." },
  { status: "402", code: "plan_limit", meaning: "A plan limit would be passed, such as published posts in a month." },
  { status: "403", code: "forbidden", meaning: "Not allowed. For example, test keys can’t publish, only a person can manage keys and connect accounts, and apps approved by a reviewer can only read." },
  { status: "404", code: "not_found", meaning: "That post, account, profile, media item or key wasn’t found in this workspace." },
  { status: "405", code: "method_not_allowed", meaning: "That address doesn’t accept this method." },
  { status: "409", code: "conflict", meaning: "The post is in a state that doesn’t allow this, such as editing a post that already started sending, or publishing something that isn’t a draft." },
  { status: "413", code: "too_large", meaning: "The request body is too large. Upload media with start_media_upload instead." },
  { status: "422", code: "idempotency_mismatch", meaning: "The Idempotency-Key was already used for a different request." },
  { status: "429", code: "rate_limited", meaning: "Too many requests. Wait the number of seconds in the Retry-After header. See Rate limits and status." },
  { status: "500", code: "internal_error", meaning: "Something went wrong on Post Social’s side. Try again in a moment." },
];

function Reference({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-subtle"><th className="w-1/2 px-4 py-2 font-medium">What you see</th><th className="px-4 py-2 font-medium">What to do</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.sees} className="align-top"><td className="px-4 py-2 text-ink">{row.sees}</td><td className="px-4 py-2">{row.fix}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TroubleshootingPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / Troubleshooting" title="Troubleshooting and error reference">
        <p>Post Social explains each failure in plain words. Find the message you saw below, and what to do about it. Names and numbers in a message are shown here as &lt;…&gt;.</p>
      </PageHeader>

      <Section id="start-here" title="Start here">
        <p>
          The quickstart lists the most common problems and their fixes. See{" "}
          <Link href="/docs/quickstart#fails" className="text-accent hover:underline">If something fails</Link>.
        </p>
        <p>To see what happened to a post, ask your AI for its publishing results. Each account has its own result: published with a live link, failed with a reason, or still in progress. A post is live only when the results show published with a live link. See <Link href="/docs/concepts#post-states" className="text-accent hover:underline">post statuses</Link>.</p>
        <p>For some problems Post Social tries again on its own, and the message says so. If a failure says it isn&apos;t something you can fix, email <a href="mailto:support@postsocial.xyz" className="text-accent hover:underline">support@postsocial.xyz</a>.</p>
      </Section>

      <Section id="reconnect" title="An account needs to be reconnected"><Reference rows={RECONNECT} /></Section>
      <Section id="connecting" title="Problems connecting an account"><Reference rows={CONNECTING} /></Section>
      <Section id="before-sending" title="Problems found before a post is sent">
        <p>Post Social checks every post against each platform&apos;s rules before sending. A post with problems is saved as a draft and the problems are listed, so nothing goes out half-right. Fix them, then publish the draft.</p>
        <Reference rows={BEFORE_SENDING} />
      </Section>
      <Section id="waiting" title="A platform limit or rule">
        <p>Platforms limit how much an account can post, and set their own rules. See the <Link href="/docs/platforms" className="text-accent hover:underline">Platforms</Link> page for the limits Post Social checks.</p>
        <Reference rows={WAITING} />
      </Section>
      <Section id="plan" title="Billing and plan limits"><Reference rows={BILLING} /></Section>
      <Section id="processing" title="The platform couldn't process a file"><Reference rows={PROCESSING} /></Section>
      <Section id="unsure" title="Post Social isn't sure whether it went out"><Reference rows={UNSURE} /></Section>
      <Section id="support" title="Something on Post Social's side"><Reference rows={SUPPORT} /></Section>

      <Section id="api-errors" title="API error codes">
        <p>
          REST errors always look like <code className="font-mono text-ink">{`{"error":{"code","message"}}`}</code>, and the MCP server returns the same message to your AI. The message is written for people. See the <Link href="/docs/api" className="text-accent hover:underline">REST API</Link> page.
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Meaning</th></tr></thead>
            <tbody className="divide-y divide-border">
              {API_CODES.map((row) => (
                <tr key={row.code} className="align-top"><td className="px-4 py-2 font-mono text-xs text-ink">{row.status}</td><td className="px-4 py-2 font-mono text-xs text-ink">{row.code}</td><td className="px-4 py-2">{row.meaning}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
