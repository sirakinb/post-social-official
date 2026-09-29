"use client";

import { TikTokCreatorInfo, TikTokOptions } from "@/lib/types";
import { Select } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { AccountAvatar } from "../account-avatar";
import { Info } from "lucide-react";

interface TikTokPanelProps {
  creatorInfo: TikTokCreatorInfo;
  options: TikTokOptions;
  onChange: (options: TikTokOptions) => void;
}

export function TikTokPanel({ creatorInfo, options, onChange }: TikTokPanelProps) {
  function update(partial: Partial<TikTokOptions>) {
    onChange({ ...options, ...partial });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <AccountAvatar platform="tiktok" name={creatorInfo.nickname} />
          <div>
            <CardTitle>TikTok</CardTitle>
            <CardDescription>
              Posting as{" "}
              <span className="font-medium text-ink">
                {creatorInfo.nickname}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!creatorInfo.canPost && (
          <div className="rounded-lg border border-warning/20 bg-warning-bg p-3 text-sm text-warning">
            This creator account cannot post right now. Please try again later.
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="tiktok-privacy"
            className="text-sm font-medium text-ink"
          >
            Who can watch this video
          </label>
          <Select
            id="tiktok-privacy"
            value={options.privacyLevel}
            onChange={(e) => update({ privacyLevel: e.target.value })}
            data-testid="tiktok-privacy"
          >
            <option value="" disabled>
              Select a privacy setting
            </option>
            {creatorInfo.privacyLevelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-subtle">
            Choose from the options available for this account.
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">Interactions</legend>
          <label
            className={`flex items-center gap-3 ${!creatorInfo.commentAvailable ? "text-ink-subtle" : ""}`}
            title={
              !creatorInfo.commentAvailable
                ? "Comments are disabled in this creator's settings."
                : undefined
            }
          >
            <Checkbox
              checked={options.commentEnabled}
              disabled={!creatorInfo.commentAvailable}
              onChange={() => update({ commentEnabled: !options.commentEnabled })}
              data-testid="tiktok-comment"
            />
            <span className="text-sm">Allow comments</span>
          </label>
          <label
            className={`flex items-center gap-3 ${!creatorInfo.duetAvailable ? "text-ink-subtle" : ""}`}
            title={
              !creatorInfo.duetAvailable
                ? "Duets are disabled in this creator's settings."
                : undefined
            }
          >
            <Checkbox
              checked={options.duetEnabled}
              disabled={!creatorInfo.duetAvailable}
              onChange={() => update({ duetEnabled: !options.duetEnabled })}
              data-testid="tiktok-duet"
            />
            <span className="text-sm">Allow Duet</span>
          </label>
          <label
            className={`flex items-center gap-3 ${!creatorInfo.stitchAvailable ? "text-ink-subtle" : ""}`}
            title={
              !creatorInfo.stitchAvailable
                ? "Stitch is disabled in this creator's settings."
                : undefined
            }
          >
            <Checkbox
              checked={options.stitchEnabled}
              disabled={!creatorInfo.stitchAvailable}
              onChange={() => update({ stitchEnabled: !options.stitchEnabled })}
              data-testid="tiktok-stitch"
            />
            <span className="text-sm">Allow Stitch</span>
          </label>
        </fieldset>

        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <Checkbox
              checked={options.disclosureEnabled}
              onChange={() =>
                update({
                  disclosureEnabled: !options.disclosureEnabled,
                  yourBrandEnabled: false,
                  brandedContentEnabled: false,
                })
              }
              data-testid="tiktok-disclosure"
            />
            <span className="text-sm font-medium text-ink">
              Content disclosure
            </span>
          </label>
          {options.disclosureEnabled && (
            <div className="ml-8 space-y-2">
              <label className="flex items-center gap-3">
                <Checkbox
                  checked={options.yourBrandEnabled}
                  onChange={() =>
                    update({ yourBrandEnabled: !options.yourBrandEnabled })
                  }
                  data-testid="tiktok-your-brand"
                />
                <span className="text-sm">Your brand</span>
              </label>
              <label className="flex items-center gap-3">
                <Checkbox
                  checked={options.brandedContentEnabled}
                  onChange={() =>
                    update({
                      brandedContentEnabled: !options.brandedContentEnabled,
                    })
                  }
                  data-testid="tiktok-branded-content"
                />
                <span className="text-sm">Branded content</span>
              </label>
            </div>
          )}
          <label className="flex items-center gap-3">
            <Checkbox checked={options.aiGenerated ?? false} onChange={() => update({ aiGenerated: !options.aiGenerated })} data-testid="tiktok-ai-generated" />
            <span className="text-sm font-medium text-ink">Label as AI-generated</span>
          </label>
        </div>

        <div className="rounded-lg border border-border bg-canvas-ivory p-3 text-sm text-ink-muted">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p>
                Video must be {creatorInfo.maxVideoDurationSec / 60} minutes or
                shorter for this account.
              </p>
              <p className="font-medium text-ink">
                By posting, you agree to TikTok&apos;s Music Usage Confirmation.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
