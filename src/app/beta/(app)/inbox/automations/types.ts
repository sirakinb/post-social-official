// What the api function returns for automations (backend/lib/inbox/automations.ts).
export type AutomationRow = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  name: string;
  platform_post_id: string | null;
  post_id: string | null;
  keywords: string[];
  match_mode: "word" | "contains" | "exact";
  exclude_keywords: string[];
  dm_message: string;
  dm_variations: string[];
  dm_buttons: Array<{ label: string; url: string }>;
  comment_reply: string | null;
  comment_reply_variations: string[];
  repeat_mode: "once" | "every_comment";
  is_active: boolean;
  created_at: string;
  account: { id: string; platform: string; handle: string | null; display_name: string; health: string } | null;
  triggered: number;
  sent: number;
  failed: number;
  skipped: number;
  clicks: number;
  people_clicked: number;
};

export type ActivityRow = {
  id: string;
  commenter_username: string | null;
  comment_text: string | null;
  status: "sent" | "skipped" | "failed";
  reason: string | null;
  dm_text: string | null;
  reply_status: "sent" | "failed" | "none" | null;
  clicks: number;
  created_at: string;
};

export type AccountOption = { id: string; platform?: string; handle: string | null; display_name: string };
