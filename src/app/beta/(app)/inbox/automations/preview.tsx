import { Label, PlatformMark } from "@/components/beta/ui";

// The follower's side of an automation, step by step: their comment, the DM they get (with its
// link buttons), and the public reply under their comment. Threads has no DMs, so there it's
// the comment and the reply.
export function AutomationPreview(props: {
  platform: string;
  account: string;
  keyword: string;
  dm: string;
  buttons: Array<{ label: string; url: string }>;
  reply: string;
  publicOnly: boolean;
}) {
  // {username} is filled in per person; the preview shows where it lands.
  const who = props.platform === "facebook" ? "their name" : "@their_handle";
  const filled = (text: string) =>
    text.split(/(\{username\})/g).map((part, i) =>
      part === "{username}" ? <span key={i} className="rounded bg-ps-plum/[0.14] px-1 text-ps-plum-soft">{who}</span> : part,
    );
  const buttons = props.buttons.filter((b) => b.label.trim());
  const steps: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: "They comment",
      body: (
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ps-segment text-ps-subtle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14Z" /></svg>
          </span>
          <div className="min-w-0 text-[13px] leading-snug">
            <p className="m-0 text-xs text-ps-subtle">Someone on your post</p>
            <p className="m-0 mt-0.5 break-words">{props.keyword ? props.keyword : <span className="text-ps-subtle">Any comment</span>}</p>
          </div>
        </div>
      ),
    },
    ...(props.publicOnly
      ? []
      : [
          {
            title: "They get your DM",
            body: (
              <div className="flex flex-col gap-1.5">
                <div className="rounded-2xl rounded-tl-md bg-ps-segment px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words">
                  {props.dm.trim() ? filled(props.dm) : <span className="text-ps-subtle">Your message</span>}
                </div>
                {buttons.map((b, i) => (
                  <div key={i} className="rounded-xl border border-ps-line-strong px-3 py-2 text-center text-[13px] font-medium text-ps-plum">{b.label}</div>
                ))}
              </div>
            ),
          },
        ]),
    ...(props.reply.trim()
      ? [
          {
            title: "You reply under their comment",
            body: (
              <div className="flex items-start gap-2.5">
                <PlatformMark platform={props.platform} size={28} className="rounded-full" />
                <div className="min-w-0 text-[13px] leading-snug">
                  <p className="m-0 truncate text-xs text-ps-subtle">{props.account}</p>
                  <p className="m-0 mt-0.5 break-words">{filled(props.reply)}</p>
                </div>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-5 w-px bg-ps-line" />}
          <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full border border-ps-line-strong bg-ps-surface font-mono text-[10px] text-ps-muted">{i + 1}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label className="pt-[3px]">{step.title}</Label>
            {step.body}
          </div>
        </li>
      ))}
    </ol>
  );
}
