// Small string helpers that take linear time on any input. A trailing-trim regex such as
// /\/+$/ backtracks quadratically on a long run that doesn't reach the end ("////...x"),
// so request paths and other values people send are trimmed with these loops instead.

// `value` without any of `chars` at its end.
export function trimEndChars(value: string, chars: string) {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return end === value.length ? value : value.slice(0, end);
}

export const trimTrailingSlashes = (value: string) => trimEndChars(value, "/");
