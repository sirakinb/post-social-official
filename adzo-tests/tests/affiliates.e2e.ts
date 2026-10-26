import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The public affiliate page: the offer (20% for 24 months), who it's for, and the button to
// apply by email. Joining is by approval, so the button opens an email to hello@postsocial.xyz.
test('a visitor sees the affiliate offer and a way to apply', async ({ app, screen, browser }) => {
  await app.open('/affiliates');
  await expect(browser).toHaveTitle(/Affiliate program/);
  await expect(screen.getByRole('heading', 'Earn 20% for 24 months.')).toBeVisible();
  await expect(screen.getByRole('heading', 'Friends of Post Social')).toBeVisible();
  await expect(screen.getByRole('link', 'Apply to join').first()).toBeVisible();
  await expect(screen.getByRole('link', 'Apply to join').first()).toHaveAttribute('href', 'mailto:hello@postsocial.xyz?subject=Affiliate%20application');
});
