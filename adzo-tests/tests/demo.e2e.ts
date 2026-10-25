import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// The Lantern Studio demo workspace (scripts/seed-demo-workspace.ts) used for product videos.
test('the demo login opens Lantern Studio with its accounts', async ({ app, screen, browser }) => {
  const demo = credentials.user('demo');
  await app.open('/beta/login');
  await screen.getByLabel('Email').fill(demo.username);
  await screen.getByLabel('Password').fill(demo.password);
  await screen.getByRole('button', 'Sign in').tap();

  // Signing in lands on Accounts.
  await expect(browser).toHaveURL(/\/beta\/accounts/, { timeout: 30_000 });
  await expect(screen.getByText(/@lantern/).first()).toBeVisible();
});
