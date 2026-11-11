import type { NextRequest } from "next/server";
import { finishRedirect } from "../../finish-redirect";

// Google only accepts sign-in callbacks on domains we own, so YouTube's registered callback
// is this page.
export function GET(request: NextRequest) {
  return finishRedirect(request.nextUrl, "youtube");
}
