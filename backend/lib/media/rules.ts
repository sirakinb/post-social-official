// Media rules shared by the media function, the worker and the web app. Runtime-neutral:
// no Node, Deno or browser-only APIs.

export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024; // 1 GB

export const ALLOWED_MEDIA_TYPES = {
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MEDIA_TYPES;
export type MediaType = (typeof ALLOWED_MEDIA_TYPES)[AllowedMimeType];

export function mediaTypeFor(mimeType: string): MediaType | null {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return (ALLOWED_MEDIA_TYPES as Record<string, MediaType>)[normalized] ?? null;
}

export function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export const UPLOAD_LINK_SECONDS = 60 * 60; // presigned part URLs live for an hour

// R2 multipart rules: parts are 5 MiB to 5 GiB (the last may be smaller), at most 10,000.
const MIN_PART_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 10_000;

export function planParts(sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error("File size must be a positive whole number of bytes.");
  // Aim for about 64 parts so progress is smooth and retries are cheap.
  const partSize = Math.max(MIN_PART_BYTES, Math.ceil(sizeBytes / 64 / (1024 * 1024)) * 1024 * 1024);
  const partCount = Math.ceil(sizeBytes / partSize);
  if (partCount > MAX_PARTS) throw new Error("File is too large to upload in parts.");
  return { partSize, partCount };
}

// Byte length of each part: all full-size except possibly the last.
export function partLength(sizeBytes: number, partSize: number, partNumber: number) {
  return Math.min(partSize, sizeBytes - (partNumber - 1) * partSize);
}

// Keeps letters, numbers, dots, dashes and underscores; everything else becomes a dash.
export function safeFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(-120);
  return cleaned || "file";
}

export function storageKey(workspaceId: string, mediaId: string, fileName: string) {
  return `workspaces/${workspaceId}/media/${mediaId}/${safeFileName(fileName)}`;
}

export type UploadRequest = { fileName: string; mimeType: string; sizeBytes: number };

export function uploadProblem(request: UploadRequest): string | null {
  if (!request.fileName?.trim()) return "Choose a file to upload.";
  if (!mediaTypeFor(request.mimeType ?? "")) {
    return "That file type is not supported. Use MP4, MOV or WebM video, or JPEG, PNG or WebP images.";
  }
  if (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes <= 0) return "The file is empty.";
  if (request.sizeBytes > MAX_MEDIA_BYTES) return "Files can be at most 1 GB.";
  return null;
}

const PRIVATE_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

// First line of defence for imports: shape of the link. The worker repeats the network
// check after resolving DNS, because a public-looking name can point at a private address.
export function importUrlProblem(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "That is not a valid link.";
  }
  if (url.protocol !== "https:") return "Only https links can be imported.";
  if (url.username || url.password) return "Links with a username or password cannot be imported.";
  if (url.port && url.port !== "443") return "Links must use the standard https port.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOSTNAMES.test(host) || isPrivateAddress(host)) return "Links to private or local network addresses cannot be imported.";
  if (!host.includes(".") && !host.includes(":")) return "Links to private or local network addresses cannot be imported.";
  return null;
}

// True for loopback, private, link-local, carrier-grade NAT, multicast, reserved and other
// non-public IPv4/IPv6 addresses, including IPv4-mapped IPv6. Non-IP strings return false.
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);
  if (!ip.includes(":")) return false;

  const mapped = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const inner = parseIPv4(mapped[1]);
    return inner ? isPrivateIPv4(inner) : true;
  }
  const groups = expandIPv6(ip);
  if (!groups) return true; // unparseable IPv6: treat as unsafe
  const [first] = groups;
  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return true; // mapped, other notation
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  if (first === 0x0064 && groups[1] === 0xff9b) return true; // NAT64 can reach IPv4 internals
  if (first === 0x2002) return true; // 6to4 embeds an IPv4 address
  return false;
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIPv4([a, b]: number[]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function expandIPv6(ip: string): number[] | null {
  const [head, tail, extra] = ip.split("::");
  if (extra !== undefined) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const headParts = parse(head);
  const tailParts = tail === undefined ? [] : parse(tail);
  const missing = 8 - headParts.length - tailParts.length;
  if (tail === undefined ? headParts.length !== 8 : missing < 1) return null;
  const all = [...headParts, ...Array(tail === undefined ? 0 : missing).fill("0"), ...tailParts];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}
