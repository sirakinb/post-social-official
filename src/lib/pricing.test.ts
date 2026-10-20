import { describe, expect, it } from "vitest";
import { MONTHLY_CREDIT, monthlyBill, unitsFromAccountDays } from "./pricing";

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
