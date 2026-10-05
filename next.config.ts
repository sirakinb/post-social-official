import type { NextConfig } from "next";

const developmentSources = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const developmentConnections = process.env.NODE_ENV === "development" ? " ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*" : "";

// Browsers upload media straight to our Cloudflare R2 account (signed part links).
const mediaStorage = "https://5e9cbd18080d4f973442560e2140a3e0.r2.cloudflarestorage.com";

const securityHeaders = [
  { key: "Content-Security-Policy", value: [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${developmentSources}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `connect-src 'self' ${mediaStorage} https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site${developmentConnections}`,
    "upgrade-insecure-requests",
  ].join("; ") },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // The REST API and MCP server run as an InsForge function; this site gives them their
  // public addresses (/api/v1/..., /mcp).
  async rewrites() {
    const api = process.env.API_BASE_URL;
    if (!api) return [];
    return [
      { source: "/api/v1/:path*", destination: `${api}/v1/:path*` },
      { source: "/mcp", destination: `${api}/mcp` },
      // OAuth for AI apps (ChatGPT, the Claude app): discovery, registration and tokens.
      // The sign-in page itself is /oauth/authorize, a page on this site.
      { source: "/.well-known/oauth-protected-resource", destination: `${api}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: `${api}/.well-known/oauth-protected-resource/:path*` },
      { source: "/.well-known/oauth-authorization-server", destination: `${api}/.well-known/oauth-authorization-server` },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: `${api}/.well-known/oauth-authorization-server` },
      { source: "/oauth/register", destination: `${api}/oauth/register` },
      { source: "/oauth/token", destination: `${api}/oauth/token` },
      { source: "/oauth/revoke", destination: `${api}/oauth/revoke` },
    ];
  },
};

export default nextConfig;
