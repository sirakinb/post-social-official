import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The public affiliate page: the offer (20% for 24 months) and the sign-up button. The
// button's address is a placeholder until Aki gives the Rewardful sign-up link, so this checks
// that the button is there, not where it goes.
test('a visitor sees the affiliate offer and a sign-up button', async ({ app, screen, browser }) => {
  await app.open('/affiliates');
  await expect(browser).toHaveTitle(/Affiliate program/);
  await expect(screen.getByRole('heading', 'Earn 20% for 24 months.')).toBeVisible();
  await expect(screen.getByText('20% recurring commission.')).toBeVisible();
  await expect(screen.getByRole('link', 'Become an affiliate').first()).toBeVisible();
});
