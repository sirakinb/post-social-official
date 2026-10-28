import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// The newest email sent to a test login since a time (Adzo's inbox).
async function newestEmail(address: string, since: number): Promise<any> {
  const res = await fetch(process.env.ADZO_INBOX_URL + '?address=' + encodeURIComponent(address) + '&since=' + since, { headers: { authorization: 'Bearer ' + process.env.ADZO_AGENT_TOKEN } });
  const d: any = await res.json().catch(() => ({}));
  return d.email;
}

async function codeFor(address: string, since: number, timeoutMs = 120_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const e = await newestEmail(address, since - 5000);
    const code = e && (e.code || (String(e.subject || '').match(/\b(\d{6})\b/) || [])[1]);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('No code arrived for ' + address);
}

// A fresh customer signs up and confirms their email. The worker's next sweep (hourly, and 5
// minutes after it starts) then sends the welcome email from Aki; run the second test after it.
test('a new customer signs up and confirms their email', async ({ app, screen, browser }) => {
  const user = credentials.user('welcome_email');
  await app.open('/beta/signup');
  await screen.getByLabel('Name').fill('Nia Welcome');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Password').fill(user.password);
  let since = Date.now();
  await screen.getByRole('button', 'Create free account').tap();
  await new Promise((r) => setTimeout(r, 3000));
  if (!(await browser.evaluate(() => !!document.querySelector('#verify-code')))) {
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
});

test('the new customer gets a welcome email from Aki', async () => {
  const user = credentials.user('welcome_email');
  const until = Date.now() + 90_000;
  let email: any;
  while (Date.now() < until) {
    email = await newestEmail(user.username, 0);
    if (email && email.subject === 'Welcome to Post Social') break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  expect(email?.subject).toBe('Welcome to Post Social');
});
