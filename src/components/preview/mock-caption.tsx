import { tokenizeCaption, truncateCaption } from "@/lib/caption-text";

/** A caption as a feed shows it: hashtags and mentions emphasised, long text cut with "… more". */
export function MockCaption({ text, max, testId }: { text: string; max: number; testId?: string }) {
  const { text: shown, truncated } = truncateCaption(text, max);
  return (
    <p className="text-[11px] leading-[1.35] text-white" data-testid={testId}>
      {tokenizeCaption(shown).map((token, index) =>
        token.type === "text" ? <span key={index}>{token.value}</span> : <strong key={index} className="font-bold" data-token={token.type}>{token.value}</strong>,
      )}
      {truncated ? <span className="text-white/70"> more</span> : null}
    </p>
  );
}
