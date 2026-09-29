/** Vertical video is roughly 9:16, a width/height ratio near 0.5625. */
export function isVertical(width?: number, height?: number) {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= 0.5 && ratio <= 0.62;
}

/** Vertical video fills a phone screen; anything else is letterboxed, as the apps do. */
export function mediaFit(width?: number, height?: number): "cover" | "contain" {
  return isVertical(width, height) ? "cover" : "contain";
}

/** True only when we know the media is clearly not vertical (landscape or square). */
export function isKnownNonVertical(width?: number, height?: number) {
  if (!width || !height) return false;
  return width / height > 0.7;
}
