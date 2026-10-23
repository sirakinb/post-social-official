# DataFast setup

DataFast (visitor analytics) is added in `src/components/analytics.tsx` and loaded from the root layout on the live site only.

## Where it runs

- Runs on: the landing page, `/pricing`, `/docs`, `/changelog`, `/privacy`, `/terms`, `/data-deletion`, `/beta/login` and `/beta/signup`.
- Does not load on first visit to: the signed-in app (`/beta/...`), `/oauth/...` or `/tiktok-media/...`.
- The content policy in `next.config.ts` allows `https://datafa.st` for the script and for sending page views, and nothing broader.

## One step in the DataFast dashboard

Once the script has loaded, it follows later page changes on its own. A visitor who goes from the landing page to sign-in and then into the app would keep being tracked. To stop that, add these in DataFast under Exclusions (exact paths, plus `/*` for everything beneath). Do not use `/beta/*` alone: it would also hide the sign-in and sign-up pages.

```
/beta
/beta/accounts/*
/beta/activity/*
/beta/analytics/*
/beta/api/*
/beta/billing/*
/beta/calendar/*
/beta/create/*
/beta/drafts/*
/beta/keys/*
/beta/media/*
/beta/phone/*
/beta/settings/*
/beta/stats/*
/beta/usage/*
/beta/auth/*
/beta/authorize/*
/beta/connect/*
/beta/share/*
/beta/reset-password/*
/oauth/*
```

When a new page is added under `/beta`, add it to this list.

## Checking it works

After the first deploy, visit postsocial.xyz and look for the visit in DataFast (it can take a few minutes). If nothing appears, open the browser console and look for a "Refused to…" message, which would mean the content policy needs another entry.

## Bot traffic tracking (AI assistants and crawlers)

DataFast's server-side package (`@datafast/ai-crawl`) is called from `src/proxy.ts`, with its settings in `src/lib/analytics/bot-tracking.ts`. It notes when AI assistants (such as ChatGPT or Claude fetching a page to answer a question), search engines and model-training crawlers request our public pages, including `robots.txt`, `llms.txt` and the sitemap. Browser tracking can't see them, because crawlers skip JavaScript.

- Live site only. Previews and staging don't send anything.
- Skipped: `/beta`, `/oauth`, `/mcp`, `/tiktok-media`, the API, and any address with a query string.
- Only requests DataFast recognises as crawlers are sent, with the page address, the crawler's user agent and its IP address. Human visits are not sent.
- Included allowance: 100,000 accepted requests per account per billing cycle; extra capacity is $9 a month per million (DataFast's pricing page). Reaching the allowance only pauses bot traffic, not normal analytics.
- Look for the Bot traffic card in the DataFast dashboard after a deploy. It can stay empty until a known crawler visits.
- The proxy now runs on every page request (it skips images, scripts and other static files), not just `/beta` and the API.
- Optional: DataFast offers a request token (`authToken`) so only our server can report. It isn't set up.

## Revenue attribution (Stripe)

DataFast can credit each payment to the channel the visitor came from. Post Social uses DataFast's Checkout method, since the card page is a Stripe Checkout session created on our server.

- When someone presses Add card (`addCard` in `src/app/beta/(app)/billing/actions.ts`), the server reads their `datafast_visitor_id` and `datafast_session_id` cookies and sends them along. `startCheckout` in `backend/lib/billing.ts` adds them to the session's `metadata`, next to `workspace_id`. Values that don't look like ids (letters, numbers, `.`, `_`, `-`, up to 100 characters) are dropped.
- The cookies exist only where the DataFast script runs, which is the live site. On previews and staging nothing is added.
- Not needed: a webhook (DataFast says it handles this itself).
- Still to do in DataFast (not in code): Site Settings, then Revenue, then connect Stripe and follow the on-screen steps.
- Unconfirmed: DataFast's Checkout page doesn't say how it treats subscription renewals, so the first card payment is the one that is clearly attributed. After connecting Stripe, test with a real card checkout from a landing-page visit and check the dashboard.
- Other methods (PaymentIntent, Payment Links) don't apply: Post Social has neither.
