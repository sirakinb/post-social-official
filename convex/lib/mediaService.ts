import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

type MutationCtx = GenericMutationCtx<DataModel>;

export type SaveMediaArgs = {
  workspaceId: Id<"workspaces">;
  userId: Id<"users">;
  storageId: Id<"_storage">;
  fileName: string;
  mimeType: string;
  mediaType: "video" | "image";
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  checksumSha256?: string;
};

const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);

export function validatedMediaMetadata(args: Omit<SaveMediaArgs, "workspaceId" | "userId" | "storageId">) {
  if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0 || args.sizeBytes > MAX_MEDIA_BYTES) throw new Error("Media must be between 1 byte and 500 MB.");
  if (!ALLOWED_MIME_TYPES.has(args.mimeType)) throw new Error("Use a JPEG, PNG, WebP, MP4, MOV, or WebM file.");
  const expectedType = args.mediaType === "video" ? args.mimeType.startsWith("video/") : args.mimeType.startsWith("image/");
  if (!expectedType) throw new Error("The media type does not match the uploaded file.");
  if (args.durationSeconds !== undefined && (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 || args.durationSeconds > 60 * 60)) throw new Error("Video duration must be between 1 second and 60 minutes.");
  for (const [label, value] of [["width", args.width], ["height", args.height]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 16_384)) throw new Error(`Media ${label} must be between 1 and 16384 pixels.`);
  }
  if (args.checksumSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(args.checksumSha256)) throw new Error("The media checksum is not a valid SHA-256 value.");
  const fileName = args.fileName.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim().slice(0, 180);
  if (!fileName) throw new Error("The uploaded file needs a valid name.");
  return { ...args, fileName };
}

export async function saveMediaCore(ctx: MutationCtx, args: SaveMediaArgs) {
  const metadata = validatedMediaMetadata(args);
  const uploaded = await ctx.db.system.get(args.storageId);
  if (!uploaded) throw new Error("The uploaded media file could not be found.");
  if (uploaded.size !== args.sizeBytes) throw new Error("The uploaded file size does not match its media record.");
  if (uploaded.contentType && uploaded.contentType !== args.mimeType) throw new Error("The uploaded file type does not match its media record.");
  const mediaId = await ctx.db.insert("mediaAssets", { workspaceId: args.workspaceId, uploadedBy: args.userId, storageId: args.storageId, fileName: metadata.fileName, mimeType: metadata.mimeType, mediaType: metadata.mediaType, sizeBytes: metadata.sizeBytes, durationSeconds: metadata.durationSeconds, width: metadata.width, height: metadata.height, checksumSha256: metadata.checksumSha256, createdAt: Date.now() });
  return { mediaId };
}
