"use client";

import { YouTubeOptions } from "@/lib/types";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select } from "../ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { AccountAvatar } from "../account-avatar";
import { Info } from "lucide-react";

interface YouTubePanelProps {
  accountName: string;
  options: YouTubeOptions;
  onChange: (options: YouTubeOptions) => void;
  fallbackTitle: string;
  warnings: string[];
}

export function YouTubePanel({ accountName, options, onChange, fallbackTitle, warnings }: YouTubePanelProps) {
  function update(partial: Partial<YouTubeOptions>) {
    onChange({ ...options, ...partial });
  }

  const effectiveTitle = options.title.trim() || fallbackTitle;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <AccountAvatar platform="youtube" name={accountName} />
          <div>
            <CardTitle>YouTube</CardTitle>
            <CardDescription>
              Publishing as <span className="font-medium text-ink">{accountName}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="youtube-title" className="text-sm font-medium text-ink">
            Video title
          </label>
          <Input
            id="youtube-title"
            placeholder={fallbackTitle || "Use the main caption"}
            value={options.title}
            onChange={(event) => update({ title: event.target.value })}
            data-testid="youtube-title"
          />
          <p className={`text-xs ${effectiveTitle.length > 100 ? "text-error" : "text-ink-subtle"}`}>
            {effectiveTitle.length.toLocaleString()} / 100 characters. Leave blank to use the main caption.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="youtube-description" className="text-sm font-medium text-ink">
            Description
          </label>
          <Textarea
            id="youtube-description"
            rows={3}
            placeholder="Optional. Leave blank to use the main caption."
            value={options.description}
            onChange={(event) => update({ description: event.target.value })}
            data-testid="youtube-description"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="youtube-privacy" className="text-sm font-medium text-ink">
            Who can watch this video
          </label>
          <Select
            id="youtube-privacy"
            value={options.privacyStatus}
            onChange={(event) => update({ privacyStatus: event.target.value as YouTubeOptions["privacyStatus"] })}
            data-testid="youtube-privacy"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </Select>
        </div>

        {warnings.map((warning) => (
          <div key={warning} className="rounded-lg border border-warning/20 bg-warning-bg p-3 text-sm text-warning">
            {warning}
          </div>
        ))}

        <div className="rounded-lg border border-border bg-canvas-ivory p-3 text-sm text-ink-muted">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p>
                Shorts are vertical 9:16 videos up to 60 seconds. Longer or landscape
                videos still publish, but YouTube may not treat them as Shorts.
              </p>
              <p className="font-medium text-ink">&quot;#Shorts&quot; is added to the title automatically.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
