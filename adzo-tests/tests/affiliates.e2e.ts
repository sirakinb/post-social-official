import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The public affiliate page: the offer (20% for 24 months), who it's for, and the button to
// join. Anyone can join: the button opens Rewardful's sign-up page (since 2026-10-26).
test('a visitor sees the affiliate offer and a way to join', async ({ app, screen, browser }) => {
  await app.open('/affiliates');
  await expect(browser).toHaveTitle(/Affiliate program/);
  await expect(screen.getByRole('heading', 'Earn 20% for 24 months.')).toBeVisible();
  await expect(screen.getByRole('heading', 'Friends of Post Social')).toBeVisible();
  await expect(screen.getByRole('link', 'Join the program').first()).toBeVisible();
  await expect(screen.getByRole('link', 'Join the program').first()).toHaveAttribute('href', 'https://post-social.getrewardful.com/signup');
});
