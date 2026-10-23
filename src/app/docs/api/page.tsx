import { Code, PageHeader } from "@/components/docs/parts";
import { API_URL, SITE } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: REST API · Post Social",
  description: "Base address, authentication, errors and an example request for the Post Social REST API.",
};

export default function ApiPage() {
  return (
    <div>
      <PageHeader label="Post Social / Docs / API and CLI reference" title="REST API" />
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
        <p>Base address <code className="font-mono text-ink">{API_URL}</code>. Send <code className="font-mono text-ink">Authorization: Bearer ps_live_...</code> (or a signed-in app&apos;s token).</p>
        <p>The full description is at <a className="text-accent hover:underline" href={`${API_URL}/openapi.json`}>{`${API_URL}/openapi.json`}</a> (OpenAPI 3.1). For AIs, a summary is at <a className="text-accent hover:underline" href={`${SITE}/llms.txt`}>/llms.txt</a>.</p>
        <p>Errors always look like <code className="font-mono text-ink">{`{"error":{"code","message"}}`}</code> with a plain-language message. Writes accept an <code className="font-mono text-ink">Idempotency-Key</code> header, so retrying never posts twice.</p>
      </div>
      <Code>{`curl ${API_URL}/posts -H "Authorization: Bearer $POSTSOCIAL_API_KEY" -H "Content-Type: application/json" \\
  -d '{"caption":"Hello","destinations":[{"account_id":"<id>","options":{"media_type":"text"}}]}'`}</Code>
    </div>
  );
}
