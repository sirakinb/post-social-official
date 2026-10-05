// The visitor's address as Vercel reports it (Vercel sets these headers itself; visitors
// can't override them), plus the proof that lets our API functions believe it.
export function visitorIp(headers: Headers): string | null {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export function forwardingHeaders(headers: Headers): Record<string, string> {
  const secret = process.env.INTERNAL_PROXY_SECRET;
  const ip = visitorIp(headers);
  return secret && ip ? { "X-PS-Client-IP": ip, "X-PS-Proxy-Secret": secret } : {};
}
