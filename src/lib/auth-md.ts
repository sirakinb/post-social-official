import { API_URL, MCP_URL, SITE } from "@/lib/api-docs";

// /auth.md (the Auth.md convention, workos.com/auth-md): how an AI agent gets access to Post
// Social. A person always signs up and approves the agent; agents can't create accounts on
// their own, so there is no agent_auth registration block in the OAuth metadata.
export function authMd() {
  return `# Post Social auth.md

How AI agents get access to Post Social.

## Who this is for

AI agents and apps (Claude, ChatGPT, Codex, Cursor, your own code) that post to social accounts for a person who uses Post Social.

## How access works

A person creates the Post Social account and connects their social accounts. An agent then gets access in one of two ways, and always acts for that person's workspace:

1. **Sign in with OAuth (recommended for MCP apps).** OAuth 2.1 with PKCE and dynamic client registration.
   - Protected resource metadata: ${SITE}/.well-known/oauth-protected-resource
   - Authorization server metadata: ${SITE}/.well-known/oauth-authorization-server (issuer ${SITE})
   - Register the client at ${SITE}/oauth/register, send the person to ${SITE}/oauth/authorize, and exchange the code at ${SITE}/oauth/token. The person sees what the agent may do and presses Allow.
   - Scope: \`posts\`.
2. **API key.** The person creates a key in Post Social (Connect your AI, API keys) and gives it to the agent. Test keys can do everything except publish.

Agents cannot create Post Social accounts or credentials on their own: there is no self-registration endpoint. Send the person to ${SITE}/beta/signup if they don't have an account.

## Using the credential

Send it as a bearer token in the Authorization header: \`Authorization: Bearer <token or ps_live_ key>\`.

- MCP server (streamable HTTP): ${MCP_URL}
- REST API: ${API_URL} (OpenAPI: ${API_URL}/openapi.json)
- API catalog: ${SITE}/.well-known/api-catalog

## Revoking access

The person can disconnect an AI app or delete a key at any time in Post Social (Connect your AI). Apps can revoke their own tokens at ${SITE}/oauth/revoke.

## More

- Connect an AI: ${SITE}/docs/connect
- Permissions and safety: ${SITE}/docs/safety
`;
}
