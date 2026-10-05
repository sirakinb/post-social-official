// Post stats are switched on per environment (ANALYTICS_PLATFORMS). Where they are off, the
// Stats page and its link do not exist, so nothing half-available is shown.
export function analyticsEnabled() {
  return (process.env.ANALYTICS_PLATFORMS ?? "").split(",").some((p) => p.trim());
}
