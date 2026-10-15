// When a destination went live. Destinations have no column for it: the worker writes a
// destination.published audit event in the same statement that sets the status, so that
// event's time is the publish time. Older rows without the event fall back to when the
// destination's completed publish job finished. Null until the destination is published.
export const publishedAtSql = (d: string) => `CASE WHEN ${d}.status = 'published' THEN coalesce(
  (SELECT min(e.occurred_at) FROM public.audit_events e
   WHERE e.entity_type = 'destination' AND e.entity_id = ${d}.id AND e.event_type = 'destination.published' AND e.workspace_id = ${d}.workspace_id),
  (SELECT max(j.finished_at) FROM public.publish_jobs j WHERE j.destination_id = ${d}.id AND j.state = 'complete')) END`;

// A post's published time is its first destination's: when it first went out anywhere.
export function firstPublishedAt<T>(destinations: { published_at?: T | null }[]): T | null {
  let first: T | null = null;
  for (const { published_at: at } of destinations) {
    if (at === null || at === undefined) continue;
    if (first === null || new Date(at as never).getTime() < new Date(first as never).getTime()) first = at;
  }
  return first;
}
