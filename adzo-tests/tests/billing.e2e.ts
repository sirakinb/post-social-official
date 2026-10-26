import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// Paying to go past the 2 free accounts. A new workspace starts on Free (2 accounts); adding a
// card through Stripe Checkout moves it to Paid, which is what lets a person connect a 3rd and
// 4th account. Staging only: staging uses Stripe's sandbox, so the card below is Stripe's public
// test card and nothing is charged. The test stops before typing a card unless Checkout is in
// test mode (a cs_test_ session).

// The login was created once by signing up on staging and confirming the emailed code. The
// test signs in with it.
test.setup('sign in as the billing test login', { sessions: ['billing'] }, async ({ app, screen, session, browser }) => {
  const user = credentials.user('billing');

  await app.open('/beta/login');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Password').fill(user.password);
  await screen.getByRole('button', 'Sign in').tap();

  await expect(browser).toHaveURL(/\/beta(\/|$)/);
  await expect(screen.getByRole('link', 'Accounts')).toBeVisible();
  await session.save('billing');
});

test('a free workspace adds a card so it can connect a 3rd and 4th account', { session: 'billing' }, async ({ app, screen, browser }) => {
  await app.open('/beta/billing');
  // Subscribing moves the workspace to Paid for good, so on a rerun this login is already
  // paid: check that state instead (a fresh free login is needed to exercise checkout again).
  if (await browser.evaluate(() => /Next charge/.test(document.body.innerText))) {
    await expect(screen.getByText('Next charge')).toBeVisible();
    return;
  }
  await expect(screen.getByText("You're on the free plan. Add a card when you want account 3.")).toBeVisible();

  await screen.getByRole('button', 'Add a card').tap();
  await expect(browser).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
  // Safety: only ever type Stripe's test card into a sandbox checkout.
  await expect(browser).toHaveURL(/cs_test_/);

  await expect(screen.getByText('Sandbox')).toBeVisible();
  await screen.getByLabel('Email').fill(credentials.user('billing').username);
  await screen.getByTestId('card-accordion-item').tap();
  await screen.getByLabel('Card number').fill('4242424242424242');
  await screen.getByLabel('Expiration').fill('12 / 34');
  await screen.getByRole('textbox', 'Credit or debit card CVC/CVV').fill('123');
  await screen.getByLabel('Cardholder name').fill('Adzo Billing Test');
  await screen.getByLabel('ZIP').fill('10001');
  // Stripe offers to save the card with Link, which then wants a phone number; skip it.
  await screen.getByRole('checkbox', 'Save my information with Link for faster checkout').uncheck();
  await screen.getByRole('button', 'Subscribe').tap();

  await expect(browser).toHaveURL(/\/beta\/billing\?checkout=/, { timeout: 60_000 });
  await expect(screen.getByText('Card added. Connect as many accounts as you need.')).toBeVisible();
});
