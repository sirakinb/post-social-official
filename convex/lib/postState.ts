export type ApprovalPolicy = "confirm_each" | "approve_after_draft" | "autonomous";
export type PostState =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "processing"
  | "published"
  | "partially_published"
  | "failed"
  | "cancelled";

const transitions: Record<PostState, readonly PostState[]> = {
  draft: ["awaiting_approval", "approved", "cancelled"],
  awaiting_approval: ["approved", "draft", "cancelled"],
  approved: ["scheduled", "processing", "cancelled"],
  scheduled: ["processing", "cancelled"],
  processing: ["published", "partially_published", "failed"],
  published: [],
  partially_published: [],
  failed: [],
  cancelled: [],
};

export function assertPostTransition(from: PostState, to: PostState) {
  if (!transitions[from].includes(to)) {
    throw new Error(`Invalid post transition: ${from} -> ${to}`);
  }
}

export function stateAfterPublishRequest(policy: ApprovalPolicy): PostState {
  return policy === "autonomous" ? "approved" : "awaiting_approval";
}

export function stateAfterApproval(scheduledAt: number | undefined, now: number): PostState {
  return scheduledAt !== undefined && scheduledAt > now ? "scheduled" : "processing";
}

const policyWeight: Record<ApprovalPolicy, number> = {
  autonomous: 0,
  approve_after_draft: 1,
  confirm_each: 2,
};

export function strictestPolicy(policies: ApprovalPolicy[]): ApprovalPolicy {
  if (policies.length === 0) throw new Error("At least one destination is required.");
  return policies.reduce((strictest, policy) =>
    policyWeight[policy] > policyWeight[strictest] ? policy : strictest
  );
}
