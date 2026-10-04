import type { Metadata } from "next";
import { GeistSans, GeistMono } from "./fonts";
import "./globals.css";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { EnvironmentBadge } from "@/components/environment-badge";

export const metadata: Metadata = {
  title: "Post Social — Social media posting for AI-native creators and operators",
  description:
    "Let Claude, ChatGPT, or your own automations draft and schedule to TikTok, Instagram, Facebook, Threads, YouTube, LinkedIn, Bluesky, and X.",
  icons: { icon: "/post-social-icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased min-h-screen`}
      >
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <EnvironmentBadge />
      </body>
    </html>
  );
}
