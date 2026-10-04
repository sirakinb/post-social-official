// Pure rules for the InsForge sign-in flow, shared by the proxy, server actions and the
// account script. No framework imports, so they are easy to test.

export const BETA_HOME = "/beta";
export const BETA_LOGIN = "/beta/login";

// Pages under /beta that signed-out visitors may open.
export const PUBLIC_BETA_PATHS = [BETA_LOGIN, "/beta/reset-password"] as const;

export function isPublicBetaPath(pathname: string) {
  return (PUBLIC_BETA_PATHS as readonly string[]).includes(pathname.replace(/\/+$/, "") || "/");
}

// Only same-site paths inside the new app are allowed as post-sign-in destinations, so a
// crafted ?next= link cannot send someone to another site.
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return BETA_HOME;
  let url: URL;
  try {
    url = new URL(next, "https://postsocial.invalid");
  } catch {
    return BETA_HOME;
  }
  if (url.origin !== "https://postsocial.invalid") return BETA_HOME;
  const path = url.pathname;
  if (path !== BETA_HOME && !path.startsWith(`${BETA_HOME}/`)) return BETA_HOME;
  if (isPublicBetaPath(path)) return BETA_HOME;
  return `${path}${url.search}`;
}

// Mirrors [auth.password] in insforge.toml.
export const PASSWORD_MIN_LENGTH = 12;

export function passwordProblem(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

type MaybeAuthError = { statusCode?: number; error?: string; message?: string } | null | undefined;

// Plain-language messages. Sign-in failures never reveal whether the email exists.
export function signInErrorMessage(error: MaybeAuthError) {
  if (!error) return null;
  if (error.statusCode === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return "The sign-in service is not responding. Try again in a moment.";
  }
  return "That email and password do not match. Check them and try again.";
}

export function resetErrorMessage(error: MaybeAuthError) {
  if (!error) return null;
  if (error.statusCode === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return "The sign-in service is not responding. Try again in a moment.";
  }
  return "That code is not valid or has expired. Request a new one and try again.";
}
