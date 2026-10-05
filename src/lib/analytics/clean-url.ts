// Page addresses sent to analytics, minus anything that could identify a person or act as
// a one-time code (sign-in codes, return paths, messages naming accounts, emails).
export const URL_PROPERTIES = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer", "$pathname"];
const SENSITIVE_PARAMS = /^(code|state|next|message|error|error_description|email|token|connected|scope)$/i;

export function cleanUrl(value: string): string {
  try {
    const url = new URL(value, "https://x.invalid");
    for (const name of [...url.searchParams.keys()]) if (SENSITIVE_PARAMS.test(name)) url.searchParams.set(name, "[removed]");
    return url.origin === "https://x.invalid" ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return value;
  }
}
