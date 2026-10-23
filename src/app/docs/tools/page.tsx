import { PageHeader } from "@/components/docs/parts";
import { documentedOperations } from "@/lib/api-docs";

export const metadata = {
  title: "Docs: tools · Post Social",
  description: "Every action available over MCP, REST and the command line.",
};

export default function ToolsPage() {
  const ops = documentedOperations();
  return (
    <div>
      <PageHeader label="Post Social / Docs / API and CLI reference" title="Tools">
        <p>The same {ops.length} actions everywhere: MCP tool name, REST endpoint and CLI command.</p>
      </PageHeader>
      <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
        {ops.map((op) => (
          <details key={op.name} className="group px-5 py-3">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-sm text-ink">{op.name}</span>
              <span className="text-xs text-ink-subtle">{op.title}{op.destructive ? " · removes or cancels" : ""}</span>
            </summary>
            <p className="mt-2 text-sm text-ink-muted">{op.description}</p>
            <p className="mt-2 break-words font-mono text-xs text-ink-subtle">{op.method} {op.path} · {op.cli}</p>
            {op.options.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                {op.options.map((o) => (
                  <li key={o.name}><span className="font-mono text-ink">{o.name}</span> <span className="text-ink-subtle">{o.type}{o.required ? ", required" : ""}</span>{o.description ? `: ${o.description}` : ""}</li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
