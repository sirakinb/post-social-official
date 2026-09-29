"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function createWebhookSignature(secret: string, timestamp: string, payloadJson: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${payloadJson}`).digest("hex");
}

export function verifyWebhookSignature(secret: string, timestamp: string, payloadJson: string, supplied: string) {
  const expected = Buffer.from(createWebhookSignature(secret, timestamp, payloadJson), "hex");
  const actual = Buffer.from(supplied.replace(/^v1=/, ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice("::ffff:".length));
  return false;
}

export function isPrivateNetworkAddress(address: string) {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : true;
}

export function validateWebhookUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain embedded credentials.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || (isIP(hostname) !== 0 && isPrivateNetworkAddress(hostname))) {
    throw new Error("Webhook URLs must use a public internet address.");
  }
  return url;
}

export async function assertPublicWebhookTarget(value: string | URL) {
  const url = validateWebhookUrl(value.toString());
  if (isIP(url.hostname) !== 0) return url;
  let results: Array<{ address: string }>;
  try {
    results = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("The webhook hostname could not be resolved.");
  }
  if (results.length === 0 || results.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error("Webhook URLs must resolve only to public internet addresses.");
  }
  return url;
}
