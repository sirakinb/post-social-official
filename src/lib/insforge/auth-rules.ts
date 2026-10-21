// Pure rules for the InsForge sign-in flow, shared by the proxy, server actions and the
// account script. No framework imports, so they are easy to test.

export const BETA_HOME = "/beta";
export const BETA_LOGIN = "/beta/login";
export const BETA_SIGNUP = "/beta/signup";
// Where Google sends people back after they sign in (must be in insforge.toml's
// allowed_redirect_urls for every site address).
export const OAUTH_CALLBACK = "/beta/auth/callback";
export const OAUTH_VERIFIER_COOKIE = "ps_oauth_verifier";

// Pages under /beta that signed-out visitors may open.
export const PUBLIC_BETA_PATHS = [BETA_LOGIN, BETA_SIGNUP, OAUTH_CALLBACK, "/beta/reset-password"] as const;

// Sign-in and sign-up pages are for signed-out visitors only; signed-in people go to the app.
export const SIGNED_OUT_ONLY_PATHS = [BETA_LOGIN, BETA_SIGNUP] as const;

// Open sign-up is switched on per environment (PUBLIC_SIGNUP=on). Off, the site stays
// invite-only: no sign-up page, no Google button.
export function signupOpen(env: Record<string, string | undefined> = process.env) {
  return env.PUBLIC_SIGNUP === "on";
}

// "Continue with Google" is hidden until Post Social has its own Google sign-in app (today
// Google's screen would name InsForge). Flip to true once it's set up in InsForge.
export const GOOGLE_SIGNIN = false;

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

export function signUpErrorMessage(error: MaybeAuthError) {
  if (!error) return null;
  if (error.statusCode === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return "The sign-in service is not responding. Try again in a moment.";
  }
  if (error.statusCode === 403) return "Sign-up is closed right now. Contact support@postsocial.xyz.";
  // Taken addresses get the same answer as other problems, so the form cannot be used to
  // find out who has an account.
  return "We couldn't create an account with that email. If you already have one, sign in instead.";
}

export function resetErrorMessage(error: MaybeAuthError) {
  if (!error) return null;
  if (error.statusCode === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return "The sign-in service is not responding. Try again in a moment.";
  }
  return "That code is not valid or has expired. Request a new one and try again.";
}
