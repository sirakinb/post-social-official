import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { copyFileSync, mkdirSync } from 'node:fs';

// A brand-new customer (a workspace with nothing connected yet) sees the three get-started
// steps on Accounts and their progress in the sidebar, and can hide them.
const SHOTS = '/data/home/videos-work/get-started';

test('a new customer sees the get-started steps and can hide them', async ({ app, screen, browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const user = credentials.user('newuser_audit');
  await app.open('/beta/login');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Password').fill(user.password);
  await screen.getByRole('button', 'Sign in').tap();
  await browser.waitForURL(/\/beta\/accounts/, { timeout: 60_000 });

  await expect(screen.getByRole('region', 'Get started')).toContainText('0 of 3 done');
  await expect(screen.getByRole('link', 'Connect')).toBeVisible();
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
