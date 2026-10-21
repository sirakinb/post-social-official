---
name: cloud-network-access
description: How a new outside host gets allowed in Post Social cloud threads — via a Network secret per host in Project settings, not a domain allowlist
metadata:
  type: reference
  modified: 2026-10-16T14:21:44.959Z
---

Aki's Project settings → Environment (cloud env "Aligno") shows no "Allowed domains" box, only **Network secrets** (host + injected header). A host is reachable from cloud threads once it has a network secret there. To unblock a new API (e.g. ScrapeCreators, 2026-10-16): Aki clicks Add secret with host `api.scrapecreators.com`, header `x-api-key`, value = key. Sessions already running may not pick it up; start a fresh thread if still 403.
**Why:** telling Aki to find a "Network access / Allowed domains" dropdown confused him — it isn't there in this UI.
