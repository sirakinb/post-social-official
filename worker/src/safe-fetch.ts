// Downloads from links people give us without letting them reach private systems (SSRF).
// Every hop is checked: https only, DNS resolved by us, every resolved address must be
// public, and the connection is pinned to the checked address so DNS cannot change between
// the check and the connection. Redirects are followed manually and re-checked.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";
import { importUrlProblem, isPrivateAddress } from "../../backend/lib/media/rules";

export class ImportError extends Error {
  // permanent: retrying will not help (bad link, wrong type, too big).
  constructor(message: string, public permanent = true) {
    super(message);
  }
}

const MAX_REDIRECTS = 5;

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const systemResolver: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function resolvePublicAddress(hostname: string, resolve: Resolver = systemResolver) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new ImportError("Links to private or local network addresses cannot be imported.");
    return { address: host, family: isIP(host) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolve(host);
  } catch {
    throw new ImportError("That link's website could not be found.");
  }
  if (addresses.length === 0) throw new ImportError("That link's website could not be found.");
  // If any address is private, refuse: an attacker can mix public and private answers.
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ImportError("Links to private or local network addresses cannot be imported.");
  }
  return addresses[0];
}

function pinnedAgent(hostname: string, pinned: { address: string; family: number }) {
  return new Agent({
    connect: {
      lookup: (_host, _options, callback) => callback(null, [{ address: pinned.address, family: pinned.family }]),
      servername: isIP(hostname) ? undefined : hostname,
    },
    headersTimeout: 30_000,
    bodyTimeout: 60_000,
  });
}

export async function safeFetch(rawUrl: string, options: { signal?: AbortSignal; resolve?: Resolver } = {}): Promise<Response> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = importUrlProblem(url);
    if (problem) throw new ImportError(problem);
    const parsed = new URL(url);
    const pinned = await resolvePublicAddress(parsed.hostname, options.resolve);
    const dispatcher = pinnedAgent(parsed.hostname, pinned);

    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", dispatcher, signal: options.signal, headers: { "User-Agent": "PostSocial-MediaImport/1.0" } });
    } catch (error) {
      if (options.signal?.aborted) throw new ImportError("The download took too long.", false);
      throw new ImportError(`The link could not be downloaded (${(error as Error).message}).`, false);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new ImportError("The link redirected without saying where to.");
      url = new URL(location, url).toString();
      continue;
    }
    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel();
      throw new ImportError(`The link's website returned an error (${response.status}).`, false);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImportError(`The link could not be downloaded (the website answered ${response.status}).`);
    }
    return response;
  }
  throw new ImportError("The link redirected too many times.");
}
