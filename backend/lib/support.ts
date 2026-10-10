// Where people go with problems they can't fix themselves, and the wording we use for it.
export const SUPPORT_EMAIL = "aki.b@pentridgemedia.com";

export const OUR_SIDE = `Something went wrong on Post Social's side. Try again, and if it keeps happening, contact support at ${SUPPORT_EMAIL}.`;
export const UNREACHABLE = `Post Social couldn't be reached. Try again in a moment, and if it keeps happening, contact support at ${SUPPORT_EMAIL}.`;

// Adds the support line to a message, once.
export function withSupport(message: string, tail = `If it keeps happening, contact support at ${SUPPORT_EMAIL}.`) {
  if (message.includes(SUPPORT_EMAIL)) return message;
  const trimmed = message.trim();
  return `${trimmed}${/[.!?]$/.test(trimmed) ? "" : "."} ${tail}`;
}

// The message for a failed request to one of our functions: a 4xx carries something the person
// can act on, so it is shown as is; a 5xx is ours, so it also points to support.
export function requestError(status: number, message: string | null | undefined) {
  if (status < 500) return message?.trim() || OUR_SIDE;
  return message?.trim() ? withSupport(message) : OUR_SIDE;
}
