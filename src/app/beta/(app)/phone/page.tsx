import Link from "next/link";
import { Card, CardHeader } from "@/components/beta/ui";
import { API_URL, SITE } from "@/lib/api-docs";

export const metadata = { title: "Post from your phone · Post Social" };

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="m-0 flex list-decimal flex-col gap-2 py-3.5 pl-9 pr-4 text-[13px] leading-relaxed text-ps-muted marker:text-ps-subtle">{children}</ol>;
}

const Field = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-ps-fg/[0.06] px-1 py-0.5 font-mono text-[12px] text-ps-text">{children}</code>;

// How to use Post Social from a phone: as a home-screen app, sharing videos into it, and
// the tips that keep uploads and sign-ins working.
export default function PhonePage() {
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6 px-4 sm:px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Post from your phone</h1>
        <p className="mt-1 text-ps-muted">Upload a video once and send it to every account from your phone.</p>
      </div>

      <Card aria-label="Add to your home screen">
        <CardHeader title="Add Post Social to your home screen" />
        <Steps>
          <li><strong className="text-ps-text">iPhone:</strong> open {SITE.replace("https://", "")} in Safari, tap Share, then Add to Home Screen.</li>
          <li><strong className="text-ps-text">Android:</strong> open it in Chrome, tap the ⋮ menu, then Install app (or Add to Home screen).</li>
          <li>It opens straight to Create, full screen like an app.</li>
        </Steps>
      </Card>

      <Card aria-label="Share from Android">
        <CardHeader title="Android: share a video straight into Post Social" />
        <Steps>
          <li>Install Post Social as above, and open it once.</li>
          <li>In Gallery or Google Photos, pick a video or photos, tap Share, then Post Social.</li>
          <li>Create opens with the files uploading. Pick your accounts and post or schedule.</li>
        </Steps>
      </Card>

      <Card aria-label="Share from iPhone">
        <CardHeader title="iPhone: a “Send to Post Social” shortcut" />
        <p className="m-0 px-4 pt-3.5 text-[13px] text-ps-muted">
          iPhones don&apos;t let websites appear in the share sheet, so a Shortcut does it: it uploads the video and opens Create with it attached. It sends the original video, and Post Social turns iPhone MOV files into MP4 for the platforms that need it. Set it up once, in the Shortcuts app:
        </p>
        <Steps>
          <li>Make an API key on the <Link href="/beta/api" className="text-ps-plum-soft hover:text-ps-text">API/MCP</Link> page and copy it.</li>
          <li>In Shortcuts, tap +, name it <Field>Send to Post Social</Field>. Tap the ⓘ button: turn on Show in Share Sheet, receive Media, and if there&apos;s no input, Ask For Photos.</li>
          <li>Add <Field>Get Details of Files</Field>: Name, of Shortcut Input. Add another: File Extension, of Shortcut Input.</li>
          <li>Add <Field>Text</Field>: the Name, a dot, then the File Extension (for example IMG_0001.MOV).</li>
          <li>
            Add <Field>Get Contents of URL</Field>: <Field>{API_URL}/media/uploads</Field>, Method POST, a header <Field>Authorization</Field> = <Field>Bearer</Field> followed by a space and your key, Request Body JSON with <Field>file_name</Field> (Text: the Text above) and <Field>single_part</Field> (Boolean: true).
          </li>
          <li>Add <Field>Get Dictionary Value</Field>: media_id, then <Field>Set Variable</Field> MediaID.</li>
          <li>Add <Field>Get Dictionary Value</Field>: parts, of Contents of URL. Add <Field>Get Item from List</Field>: First Item. Add <Field>Get Dictionary Value</Field>: url.</li>
          <li>Add <Field>Get Contents of URL</Field>: the Dictionary Value, Method PUT, Request Body File: Shortcut Input. No headers.</li>
          <li>Add <Field>Get Contents of URL</Field>: <Field>{API_URL}/media/</Field>MediaID<Field>/complete</Field>, Method POST, the same Authorization header, no body.</li>
          <li>Add <Field>Open URLs</Field>: <Field>{SITE}/beta/create?media=</Field>MediaID.</li>
        </Steps>
        <p className="m-0 border-t border-ps-fg/[0.05] px-4 py-3 text-[12px] text-ps-subtle">
          Then in Photos, open a video, tap Share, then Send to Post Social. Keep the shortcut open until Safari opens; a large video takes a minute or two on cellular. Photos work best from the Upload button in Create, which turns iPhone photos into JPEG.
        </p>
      </Card>

      <Card aria-label="Tips">
        <CardHeader title="Tips" />
        <Steps>
          <li>Keep Create open while files upload. If your phone locks or you switch apps, the upload pauses and carries on when you come back.</li>
          <li>Connect accounts in Safari or Chrome itself, not inside Instagram&apos;s or TikTok&apos;s built-in browser (Google blocks YouTube sign-in there). If connecting fails from the home-screen app, connect once in Safari or Chrome.</li>
          <li>Once a post is scheduled, you can close your phone: Post Social does the posting.</li>
        </Steps>
      </Card>
    </div>
  );
}
