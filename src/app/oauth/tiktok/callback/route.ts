import type { NextRequest } from "next/server";
import { finishRedirect } from "../../finish-redirect";

// TikTok's callback on our own domain. Changing a live TikTok app's callback needs a TikTok
// review, so this address stays put whatever backend finishes the sign-in. Prod uses it once
// TikTok approves it and TIKTOK_REDIRECT_URI points here.
export function GET(request: NextRequest) {
  return finishRedirect(request.nextUrl, "tiktok");
}
