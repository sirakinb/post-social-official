export interface MediaRemovalResult {
  deleted: boolean;
  removedFromLibrary: boolean;
  preservedPostReferences: number;
}

export function mediaRemovalMessage(result: MediaRemovalResult): string {
  if (result.preservedPostReferences > 0) {
    return "Removed from your library. Existing posts that use this media were preserved.";
  }
  return "The media file was permanently deleted.";
}
