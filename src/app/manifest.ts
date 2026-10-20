import type { MetadataRoute } from "next";

// Lets phones add Post Social to the home screen as an app. On Android, an installed Post
// Social also shows in the share sheet: photos and videos shared to it open in Create
// (public/sw.js receives them; iPhones don't support sharing into web apps).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Post Social",
    short_name: "Post Social",
    description: "Post to TikTok, Instagram, YouTube and more from one place.",
    id: "/beta",
    start_url: "/beta/create",
    scope: "/",
    display: "standalone",
    background_color: "#0B0816",
    theme_color: "#0B0816",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/beta/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "media", accept: ["video/*", "image/*", ".mp4", ".mov", ".webm", ".jpg", ".jpeg", ".png", ".webp"] }],
      },
    },
  };
}
