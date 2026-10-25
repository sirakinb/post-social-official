// Helpers Adzo gives these tests. Written by Adzo; edits here are replaced.

type Wait = { since?: number; timeoutMs?: number };

async function newestEmail(address: string, w: Wait, want: (e: any) => any) {
  const url = process.env.ADZO_INBOX_URL;
  const token = process.env.ADZO_AGENT_TOKEN;
  if (!url || !token) throw new Error('Email helpers only work in a run Adzo starts.');
  const since = w.since ?? Date.now() - 60_000;
  const until = Date.now() + (w.timeoutMs ?? 90_000);
  while (Date.now() < until) {
    const res = await fetch(url + '?address=' + encodeURIComponent(address) + '&since=' + since, { headers: { authorization: 'Bearer ' + token } });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Adzo inbox answered ' + res.status);
    const got = d.email ? want(d.email) : null;
    if (got) return got;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Nothing arrived for ' + address + ' in time.');
}

// The code in the newest email to a test login, e.g. a sign-up confirmation.
// Note the time before the action that sends it: const since = Date.now().
export function emailCode(address: string, w: Wait = {}): Promise<string> {
  return newestEmail(address, w, (e) => e.code);
}

// The first link in the newest email to a test login (containing `contains`, if given).
export function emailLink(address: string, contains = '', w: Wait = {}): Promise<string> {
  return newestEmail(address, w, (e) => (e.links || []).find((l: string) => l.includes(contains)));
}
