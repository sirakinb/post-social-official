import { describe, expect, it } from "vitest";
import { MONTHLY_CREDIT, monthlyBill, unitsFromAccountDays, xPrices, xPriceText, xStatsDays } from "./pricing";

describe("monthlyBill", () => {
  it("keeps the first 2 accounts free", () => {
    expect(monthlyBill(0).total).toBe(0);
    expect(monthlyBill(1).total).toBe(0);
    expect(monthlyBill(2).total).toBe(0);
    expect(MONTHLY_CREDIT).toBe(10);
  });
  it("charges $5 an account up to 10", () => {
    expect(monthlyBill(3).total).toBe(5);
    expect(monthlyBill(10).total).toBe(40);
  });
  it("charges each band's rate only for the accounts inside it", () => {
    // 10 × $5 + 2 × $2.50 − $10
    expect(monthlyBill(12).total).toBe(45);
    expect(monthlyBill(100).total).toBe(265);
    // 10 × $5 + 90 × $2.50 + 50 × $1 − $10
    expect(monthlyBill(150)).toMatchObject({ gross: 325, credit: 10, total: 315 });
  });
  it("bills partial months from account-days", () => {
    // 10 accounts all month, plus two accounts for 7 days each = 314 account-days
    const bill = monthlyBill(unitsFromAccountDays(314));
    expect(bill.bands[1].units).toBeCloseTo(0.4667, 3);
    expect(bill.total).toBe(41.17);
  });
  it("ignores nonsense input", () => {
    expect(monthlyBill(-5).total).toBe(0);
    expect(monthlyBill(Number.NaN).total).toBe(0);
  });
});

describe("X prices", () => {
  const before = Date.parse("2026-12-15T23:59:59Z");
  const after = Date.parse("2026-12-16T00:00:00Z");
  it("plain X posts are 2 cents until December 16, 2026, then 5 cents; links stay 25 cents", () => {
    expect(xPrices(before)).toMatchObject({ post: 0.02, postWithLink: 0.25, freeMonthly: 1 });
    expect(xPrices(after)).toMatchObject({ post: 0.05, postWithLink: 0.25, freeMonthly: 1 });
  });
  it("says the coming price until the change, and only the new one after", () => {
    expect(xPriceText(before)).toBe("2 cents each (5 cents from December 16, 2026), 25 cents with a link");
    expect(xPriceText(after)).toBe("5 cents each, 25 cents with a link");
  });
  it("reads X stats for a week until the change, then 30 days", () => {
    expect(xStatsDays(before)).toBe(7);
    expect(xStatsDays(after)).toBe(30);
  });
});
