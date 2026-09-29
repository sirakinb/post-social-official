export type MediaRemovalPlan =
  | { action: "delete"; preservedPostReferences: 0 }
  | { action: "hide"; preservedPostReferences: number };

export function mediaRemovalPlan(referenceCount: number): MediaRemovalPlan {
  if (referenceCount <= 0) {
    return { action: "delete", preservedPostReferences: 0 };
  }

  return { action: "hide", preservedPostReferences: referenceCount };
}
