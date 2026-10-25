import { appendFileSync } from 'node:fs';
import type { E2EConfig, Reporter } from 'e2e';
import { web } from '@e2e-dev/web';
import { anthropic } from '@ai-sdk/anthropic';
import { adzoExecutor } from './adzo-agent';

// Adzo runs these on the project's cloud computer against dev, staging or
// production (ADZO_APP_URL) and streams each event to ADZO_EVENTS so the
// Tests tab can show the run live. AI steps go to Adzo, which answers on
// Aki's Claude plan (adzo-agent.ts); outside Adzo they use ANTHROPIC_API_KEY.
// adzo-config v3
// Test logins Adzo made: E2E_USER_<NAME>_USERNAME and _PASSWORD in the
// project's secrets. Use them as credentials.user('<name>').
const credentials = Object.fromEntries(
  Object.keys(process.env)
    .map((k) => k.match(/^E2E_USER_(.+)_USERNAME$/)?.[1])
    .filter((n): n is string => Boolean(n && process.env['E2E_USER_' + n + '_PASSWORD']))
    .map((n) => [n.toLowerCase(), { username: process.env['E2E_USER_' + n + '_USERNAME'] ?? '', password: process.env['E2E_USER_' + n + '_PASSWORD'] ?? '' }]),
);

const adzo: Reporter = {
  name: 'adzo',
  onEvent(event) {
    const file = process.env.ADZO_EVENTS;
    if (!file) return;
    try {
      appendFileSync(file, JSON.stringify(event) + '\n');
    } catch {}
  },
};

export default {
  targets: [
    {
      engine: web({
        viewport: { width: 1280, height: 800 },
        // Fixed, so a capture never shows the machine's own timezone or locale.
        timezoneId: 'America/New_York',
        locale: 'en-US',
        screencast: { size: { width: 1280, height: 800 }, quality: 70 },
        // Gets past Vercel's deployment protection on staging and previews.
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { headers: { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' } }
          : {}),
      }),
      app: { url: process.env.ADZO_APP_URL ?? 'http://localhost:3000' },
    },
  ],
  ...(process.env.ADZO_AGENT_URL
    ? { agents: { default: { executor: adzoExecutor } } }
    : process.env.ANTHROPIC_API_KEY
      ? { agents: { default: { model: anthropic('claude-sonnet-5-5') } } }
      : {}),
  ...(Object.keys(credentials).length ? { credentials } : {}),
  reporters: ['list', adzo],
  video: 'on',
} satisfies E2EConfig;
