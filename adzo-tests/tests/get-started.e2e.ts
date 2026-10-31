import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { copyFileSync, mkdirSync } from 'node:fs';

// A brand-new customer (a workspace with nothing connected yet) sees the three get-started
// steps on Accounts and their progress in the sidebar, and can hide them.
const SHOTS = '/data/home/videos-work/get-started';

// The newest code sent to a test login (read from the subject: "123456 is your verification code").
async function codeFor(address: string, since: number, timeoutMs = 120_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(process.env.ADZO_INBOX_URL + '?address=' + encodeURIComponent(address) + '&since=' + (since - 5000), { headers: { authorization: 'Bearer ' + process.env.ADZO_AGENT_TOKEN } });
    const d: any = await res.json().catch(() => ({}));
    const code = d.email && (d.email.code || (String(d.email.subject || '').match(/\b(\d{6})\b/) || [])[1]);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('No code arrived for ' + address);
}

test('a new customer sees the get-started steps and can hide them', async ({ app, screen, browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const user = credentials.user('newuser_audit');
  // Signs the login up if it doesn't exist (test users get cleared out), else signs in.
  await app.open('/beta/signup');
  await screen.getByLabel('Name').fill('Nia Test');
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

  await expect(screen.getByRole('region', 'Get started')).toContainText('0 of 3 done');
  // No button of its own for connecting: the step points at the platform buttons below.
  await expect(screen.getByRole('region', 'Get started')).toContainText('under Connect an account below');
  await expect(screen.getByRole('region', 'Connect an account')).toContainText('Instagram');
  await expect(screen.getByRole('navigation', 'Main')).toContainText('Get started');
  copyFileSync(await app.screenshot('desktop'), `${SHOTS}/desktop.png`);

  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/beta/accounts');
  copyFileSync(await app.screenshot('phone'), `${SHOTS}/phone.png`);
  await browser.setViewport({ width: 1280, height: 800 });

  await app.open('/beta/accounts');
  await screen.getByRole('button', 'Hide').tap();
  await expect(screen.getByRole('region', 'Get started')).toBeHidden();
  await app.open('/beta/create');
  await expect(screen.getByRole('navigation', 'Main')).not.toContainText('Get started');
});
