// Post stats are switched on per environment: through each platform's own API
// (ANALYTICS_PLATFORMS) or from public pages (ANALYTICS_PUBLIC_PLATFORMS). Where both are
// off, the Analytics page and its link do not exist, so nothing half-available is shown.
export function analyticsEnabled() {
  return [process.env.ANALYTICS_PLATFORMS, process.env.ANALYTICS_PUBLIC_PLATFORMS].some((list) => (list ?? "").split(",").some((p) => p.trim()));
}
