import type { Metadata, Viewport } from "next";
import { GeistSans, GeistMono } from "./fonts";
import "./globals.css";
import { Analytics } from "@/components/analytics";
import { EnvironmentBadge, resolveAppEnv } from "@/components/environment-badge";
import { Rewardful } from "@/components/rewardful";
import { SupportChatVisibility } from "@/components/support-chat";
import { WebMcpTools } from "@/components/webmcp-tools";
import { CRISP_SNIPPET } from "@/lib/support-chat";

const title = "Post Social — Social media management for AI-native creators and operators";
const description = "Tell Claude, ChatGPT, or your own agent what to post. Post Social publishes it to TikTok, Instagram, Facebook, Threads, YouTube, LinkedIn, Bluesky and X.";

export const metadata: Metadata = {
  // Share cards need absolute image links; Vercel's production domain, else the live site.
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://www.postsocial.xyz"),
  title,
  description,
  icons: { icon: "/post-social-icon.svg", apple: "/apple-touch-icon.png" },
  // Added to an iPhone home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "Post Social", statusBarStyle: "black" },
  openGraph: { title, description, siteName: "Post Social", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { themeColor: "#0B0816" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Crisp support chat: its snippet, in the global <head> as Crisp asks. */}
        <script id="crisp-chat" dangerouslySetInnerHTML={{ __html: CRISP_SNIPPET }} />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased min-h-screen`}
      >
        {children}
        {/* Visitor analytics only on the live site, so previews and staging don't count as visitors. */}
        {resolveAppEnv() === "production" && <Analytics />}
        {/* Affiliate tracking loads everywhere (its key is public), so previews and staging can test referrals. */}
        <Rewardful />
        <SupportChatVisibility />
        {/* The site's own actions for AI agents in browsers that support WebMCP. */}
        <WebMcpTools />
        <EnvironmentBadge />
      </body>
    </html>
  );
}
