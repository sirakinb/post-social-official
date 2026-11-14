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

// X's own API charges, passed on with a small markup (we pay $0.015 and $0.20 to post, and
// $0.005 per post per day to read its stats). These are today's prices; use xPrices() for
// what a post costs at a given time.
export const X_PRICES = { post: 0.02, postWithLink: 0.25, defaultMonthlyCap: 10, freeMonthly: 1 } as const;

// Plain X posts go to 5 cents on this date, so they cover their own stats reads. Customers
// get 30 days' notice first, as the terms promise. Posts with a link stay 25 cents.
export const X_PRICE_CHANGE = { on: "2026-12-16T00:00:00Z", label: "December 16, 2026", post: 0.05 } as const;
// The free monthly X allowance ends with December 2026 (whole months, so a month's
// allowance never changes partway through): from January every X post is paid, so none
// costs Post Social more than it brings in.
export const X_FREE_ENDS = { on: "2027-01-01T00:00:00Z", lastMonth: "December 2026" } as const;

// Prices at a time. freeMonthly is the allowance of the calendar month (UTC) that time is in.
export function xPrices(now: number = Date.now()) {
  const post = now >= Date.parse(X_PRICE_CHANGE.on) ? X_PRICE_CHANGE.post : X_PRICES.post;
  const freeMonthly = now >= Date.parse(X_FREE_ENDS.on) ? 0 : X_PRICES.freeMonthly;
  return { ...X_PRICES, post, freeMonthly };
}

// "The first $1 of X posts each month is free through December 2026", or null once it ends.
export function xFreeText(now: number = Date.now()) {
  const free = xPrices(now).freeMonthly;
  return free > 0 ? `The first $${free} of X posts each month is free through ${X_FREE_ENDS.lastMonth}` : null;
}

const centsText = (dollars: number) => `${Math.round(dollars * 100)} cents`;

// "2 cents each (5 cents from December 16, 2026), 25 cents with a link" until the change,
// then "5 cents each, 25 cents with a link".
export function xPriceText(now: number = Date.now()) {
  const p = xPrices(now);
  const upcoming = p.post === X_PRICE_CHANGE.post ? "" : ` (${centsText(X_PRICE_CHANGE.post)} from ${X_PRICE_CHANGE.label})`;
  return `${centsText(p.post)} each${upcoming}, ${centsText(p.postWithLink)} with a link`;
}

// Until the price change, an X post's stats are read once (a day after it's published): at 2
// cents a post that's exactly what posting plus one read costs. From the change, at 5 cents,
// six reads over 30 days still leave a little over (see nextFetchAt "lean").
export const xFullStats = (now: number = Date.now()) => now >= Date.parse(X_PRICE_CHANGE.on);

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
