import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// Paying for a 3rd account. A new workspace starts on Free (2 accounts); the Billing page offers
// "Add account 3 · $5/mo", and Stripe Checkout charges that $5 straight away (no $0 card on file)
// before the workspace moves to Paid. Staging only: staging uses Stripe's sandbox, so the card
// below is Stripe's public test card and nothing is charged. The test stops before typing a card
// unless Checkout is in test mode (a cs_test_ session).

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

// A login that hasn't paid yet: switch to a fresh one to run checkout again.
const LOGIN = 'billing_3rd_b';

// Signs the billing login up on its first run and in after that (an unconfirmed one gets a
// code, like at sign-up).
test.setup('sign in as the billing test login', { sessions: [LOGIN] }, async ({ app, screen, session, browser }) => {
  const user = credentials.user(LOGIN);
  await app.open('/beta/signup');
  await screen.getByLabel('Name').fill('Billie Test');
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
  await session.save(LOGIN);
});

test('a free workspace pays $5 for its 3rd account', { session: LOGIN }, async ({ app, screen, browser }) => {
  const user = credentials.user(LOGIN);
  await app.open('/beta/billing');
  // Paying moves the workspace to Paid for good, so on a rerun this login is already paid:
  // check that state instead (a fresh free login is needed to exercise checkout again).
  if (!(await browser.evaluate(() => /Next charge/.test(document.body.innerText)))) {
    await expect(screen.getByText('Your first 2 accounts are free. Account 3 is $5 a month, charged when you add it.')).toBeVisible();
    // Account 3 is offered only once the 2 free accounts are connected. This login has two
    // placeholder Bluesky accounts in its dev workspace (no platform behind them); if they
    // were cleared out, add them again before running this test.
    const offered = await browser.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Add account 3')));
    if (!offered) throw new Error('Account 3 is not offered: this login needs its 2 placeholder accounts on dev.');
    await screen.getByRole('button', 'Add account 3 · $5/mo').tap();
    await expect(browser).toHaveURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
    // Safety: only ever type Stripe's test card into a sandbox checkout.
    await expect(browser).toHaveURL(/cs_test_/);
    await expect(screen.getByText('Sandbox')).toBeVisible();

    // The charge today is the 3rd account's $5, and receipts go to the person signed in.
    await expect(screen.getByText(/\$5\.00/).first()).toBeVisible();
    await expect(screen.getByText(user.username).first()).toBeVisible();

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
    await expect(screen.getByText(/You're on the paid plan\./)).toBeVisible();
  }

  // Paid: the next charge is the plain monthly $5, the card shows, receipts go to this login,
  // and the first receipt is the $5 paid at checkout.
  const month = screen.getByRole('region', 'Your month');
  await expect(month.getByText('Next charge')).toBeVisible();
  await expect(month.getByText('$5.00')).toBeVisible();
  await expect(screen.getByText(/Visa ending 4242/)).toBeVisible();
  await expect(screen.getByText('Receipts go to ' + user.username)).toBeVisible();
  await expect(screen.getByRole('region', 'Card and receipts').getByText('$5.00')).toBeVisible();
});
