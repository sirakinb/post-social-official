import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// The newest code sent to a test login. The inbox helper's code field misses this email's
// format, so read the 6 digits from the subject ("123456 is your verification code").
async function codeFor(address: string, since: number, timeoutMs = 120_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(process.env.ADZO_INBOX_URL + '?address=' + encodeURIComponent(address) + '&since=' + (since - 5000), { headers: { authorization: 'Bearer ' + process.env.ADZO_AGENT_TOKEN } });
    const d: any = await res.json().catch(() => ({}));
    const e = d.email;
    const code = e && (e.code || (String(e.subject || '').match(/\b(\d{6})\b/) || [])[1]);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('No code arrived for ' + address);
}

// A fresh customer signs up and finds one example draft waiting. On a rerun the test login
// already exists, so it signs in (an unconfirmed one gets a code, like at sign-up).
test('a new customer signs up and finds an example draft', async ({ app, screen, browser }) => {
  const user = credentials.user('newuser_draft');
  await app.open('/beta/signup');
  await screen.getByLabel('Name').fill('Dara Test');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Password').fill(user.password);
  let since = Date.now();
  await screen.getByRole('button', 'Create free account').tap();
  await new Promise((r) => setTimeout(r, 3000));
  const askedForCode = await browser.evaluate(() => !!document.querySelector('#verify-code'));
  if (!askedForCode) {
    await app.open('/beta/login');
    await screen.getByLabel('Email').fill(user.username);
    await screen.getByLabel('Password').fill(user.password);
    since = Date.now();
    await screen.getByRole('button', 'Sign in').tap();
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (await browser.evaluate(() => !!document.querySelector('#verify-code'))) {
    await screen.getByLabel('Code from the email').fill(await codeFor(user.username, since));
    await screen.getByRole('button', 'Confirm email').tap();
  }
  await browser.waitForURL(/\/beta\/accounts/, { timeout: 60_000 });

  await app.open('/beta/drafts');
  await expect(screen.getByText(/This is an example draft/)).toBeVisible();
});

test('the unsubscribe page reaches the backend and turns down a made-up link', async ({ app, screen }) => {
  await app.open('/email/unsubscribe?u=11111111-1111-4111-8111-111111111111&t=' + '0'.repeat(64));
  await screen.getByRole('button', 'Unsubscribe').tap();
  await expect(screen.getByText(/This unsubscribe link isn't valid/)).toBeVisible();
});
