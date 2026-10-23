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
