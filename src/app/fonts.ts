import { Fraunces as FrauncesFont } from "next/font/google";

export { GeistSans } from "geist/font/sans";
export { GeistMono } from "geist/font/mono";
export { GeistPixelGrid } from "geist/font/pixel";

// The landing's wordmark face (wide-tracked serif, like the Manor lockup).
export const Fraunces = FrauncesFont({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-fraunces", display: "swap" });
