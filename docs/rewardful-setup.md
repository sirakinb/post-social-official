# Rewardful setup

Rewardful runs the affiliate program (20% recurring commission for 24 months, set in the Rewardful campaign). The script is in `src/components/rewardful.tsx` and loaded from the root layout.

## Where it runs

- Runs on: the public site (landing, `/pricing`, `/affiliates`, `/docs`, `/changelog`, `/privacy`, `/terms`, `/data-deletion`), `/beta/login`, `/beta/signup` and `/beta/billing`.
- Does not load on the rest of the signed-in app (`/beta/...`), `/oauth/...` or `/tiktok-media/...`.
- Loads in every environment (live site, previews, staging), unlike DataFast, so referrals can be tested before release. The key (`a0dcca`) is Rewardful's public one.
- The content policy in `next.config.ts` allows `https://r.wdfl.co` for the script and `https://api.getrewardful.com` for the referral click. Rewardful's docs don't list domains; both come from reading `rw.js` itself. If a "Refused to…" message shows up in the browser console, the script needs another entry.

## What it does

- A visitor who arrives through an affiliate's link gets a Rewardful cookie. The script adds a hidden `referral` field (a UUID) to every form marked `data-rewardful`, which is the Add card form on `/beta/billing`.
- `addCard` in `src/app/beta/(app)/billing/actions.ts` sends that value on. `startCheckout` in `backend/lib/billing.ts` puts it in the Checkout Session's `client_reference_id`, which is how Rewardful credits the signup. Values that aren't a UUID are dropped, and with no referral the field holds the workspace id as before, because Stripe rejects a blank one.
- The workspace id is read from the session's `metadata.workspace_id` (also set on the subscription). `confirmCheckout` falls back to `client_reference_id` only for checkouts started before this change.
- Rewardful reads payments from Stripe after the fact. It is not in the payment path.

## Rewardful dashboard (not in code)

- Campaign "Friends of Post Social": 20% of every payment, maximum commission period 24 months (set 2026-10-26; it was blank, which pays forever), commissions due after 30 days, 60-day cookie, first-touch attribution. Stripe connected with read-write access.
- Joining is by approval. The Starter plan has no approval step and "Make this campaign private" needs Growth, so `/affiliates` asks people to apply by email to hello@postsocial.xyz and Aki invites them from Rewardful (Affiliates, Invite affiliates). The open sign-up link (https://post-social.getrewardful.com/signup) is deliberately not on the site.
- The API secret is not used by the site. Keep it out of files and chat.

## Checking it works

- Open the site with an affiliate link (`?via=<token>` or the campaign's link format), then in the browser console `Rewardful.referral` should show a UUID, and the Add card form should have a hidden `referral` input.
- Start a checkout in the dev or staging app, then read the Checkout Session in Stripe: `client_reference_id` is the referral and `metadata.workspace_id` is the workspace.
- Unconfirmed: Rewardful's server-side guide only shows one-time payments (`customer_creation: always`) and says nothing about subscription-mode Checkout or existing Stripe customers. Subscription-mode Checkout always creates a customer, but a full referred checkout (with commission showing in Rewardful) needs one real test before the program is announced.
