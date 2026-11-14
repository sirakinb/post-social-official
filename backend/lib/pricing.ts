// Post Social's prices, in one place: the landing page's calculator, the docs and the
// billing code all read these. Accounts are billed on a sliding scale: each band's rate
// applies only to the accounts inside it (graduated, not one rate for all). A month is
// 30 account-days per account, and the monthly credit covers the first 2 accounts.

export const PRICE_BANDS = [
  { from: 1, to: 10, perAccount: 5 },
  { from: 11, to: 100, perAccount: 2.5 },
  { from: 101, to: Infinity, perAccount: 1 },
] as const;

export const FREE_ACCOUNTS = 2;
export const MONTHLY_CREDIT = FREE_ACCOUNTS * PRICE_BANDS[0].perAccount; // $10

// X posts: what X charges us to post ($0.015, or $0.20 with a link) plus reading the post's
// stats on its schedule (6 reads at $0.005, see nextFetchAt "lean"), with a little over, so
// no X post costs Post Social more than it brings in. No free monthly X allowance: posting to
// X needs a card (comped plans aren't charged).
export const X_PRICES = { post: 0.05, postWithLink: 0.25, defaultMonthlyCap: 10, freeMonthly: 0 } as const;

const centsText = (dollars: number) => `${Math.round(dollars * 100)} cents`;

// "5 cents each, 25 cents with a link", for docs and the notes AI agents read.
export const xPriceText = () => `${centsText(X_PRICES.post)} each, ${centsText(X_PRICES.postWithLink)} with a link`;

export type BandCharge = { from: number; to: number; perAccount: number; units: number; amount: number };

const cents = (dollars: number) => Math.round(dollars * 100) / 100;

// The bill for `units` accounts held all month (fractions allowed: 15 days = 0.5).
export function monthlyBill(units: number) {
  const held = Math.max(0, Number.isFinite(units) ? units : 0);
  const bands: BandCharge[] = PRICE_BANDS.map((band) => {
    const inBand = Math.max(0, Math.min(held, band.to) - (band.from - 1));
    return { from: band.from, to: band.to, perAccount: band.perAccount, units: inBand, amount: cents(inBand * band.perAccount) };
  });
  const gross = cents(bands.reduce((sum, band) => sum + band.amount, 0));
  const credit = Math.min(gross, MONTHLY_CREDIT);
  return { units: held, bands, gross, credit, total: cents(gross - credit) };
}

// account-days ÷ 30 = billable units, the way invoices count partial months.
export const unitsFromAccountDays = (accountDays: number) => accountDays / 30;
