import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  applyCarry,
  carryForwardRemainder,
  planReceivables,
  recordPayment,
  reversalDelta,
  splitBill,
} from "../split";
import { electricityCost, waterCost } from "../tariffs";
import { DEFAULT_TARIFFS, type Transaction } from "../types";
import { mytDate, monthKey, shiftMonths } from "../dates";
import { dueOccurrences, occurrenceFor } from "../recurring";
import { configFromDraft, defaultSplitDraft, describeSplit, evenPercents } from "../split-defaults";
import { baselineForecast, detectAnomalies } from "../utilities";
import { guessCategory, parseAmount, parseStatementDate } from "../importing";
import { monthlyKwh, monthlyWaterM3 } from "../estimator";
import { normalisePhone, whatsappLink } from "../message";

const people = ["Alia", "Nana", "Alisa"];

describe("splitBill", () => {
  it("splits equally and gives leftover sen to the admin first", () => {
    const s = splitBill(100, { mode: "equal", participants: people }, "Alia");
    expect(s).toEqual({ Alia: 33.34, Nana: 33.33, Alisa: 33.33 });
  });
  it("splits by percentage exactly", () => {
    const s = splitBill(250.55, { mode: "ratio", participants: people, ratios: { Alia: 40, Nana: 30, Alisa: 30 } }, "Alia");
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(250.55, 2);
    expect(s.Alia).toBeCloseTo(100.22, 2);
  });
  it("accepts 33.33% × 3 and balances it to the exact total", () => {
    const s = splitBill(100, { mode: "ratio", participants: people, ratios: { Alia: 33.33, Nana: 33.33, Alisa: 33.33 } }, "Alia");
    expect(s).toEqual({ Alia: 33.34, Nana: 33.33, Alisa: 33.33 });
  });
  it("leaves a housemate out of a bill entirely", () => {
    const s = splitBill(120, { mode: "equal", participants: ["Alia", "Nana"] }, "Alia");
    expect(s).toEqual({ Alia: 60, Nana: 60 });
    expect(planReceivables(s, "Alia", {}).map((p) => p.debtorName)).toEqual(["Nana"]);
  });
  it("rejects percentages that do not add to 100", () => {
    expect(() => splitBill(100, { mode: "ratio", participants: people, ratios: { Alia: 50, Nana: 30, Alisa: 10 } }, "Alia")).toThrow();
  });
  it("fixed amounts leave the remainder to the admin", () => {
    const s = splitBill(1500, { mode: "fixed", participants: people, fixedAmounts: { Nana: 450, Alisa: 500 } }, "Alia");
    expect(s).toEqual({ Alia: 550, Nana: 450, Alisa: 500 });
  });
  it("fixed amounts larger than the bill are rejected", () => {
    expect(() => splitBill(100, { mode: "fixed", participants: people, fixedAmounts: { Nana: 80, Alisa: 30 } }, "Alia")).toThrow();
  });
});

describe("running balances", () => {
  it("adds debt to the next bill in full", () => {
    expect(applyCarry(50, 12.5)).toEqual({ carryIn: 12.5, amountOwed: 62.5, newBalance: 0 });
  });
  it("uses credit up to the share and keeps the rest", () => {
    expect(applyCarry(20, -30)).toEqual({ carryIn: -20, amountOwed: 0, newBalance: -10 });
    expect(applyCarry(50, -30)).toEqual({ carryIn: -30, amountOwed: 20, newBalance: 0 });
  });
  it("records partial, full and over payments", () => {
    expect(recordPayment({ amountOwed: 60, amountPaid: 0 }, 20)).toEqual({ amountPaid: 20, status: "Partial", overpayment: 0 });
    expect(recordPayment({ amountOwed: 60, amountPaid: 20 }, 40)).toEqual({ amountPaid: 60, status: "Settled", overpayment: 0 });
    expect(recordPayment({ amountOwed: 60, amountPaid: 20 }, 50)).toEqual({ amountPaid: 70, status: "Settled", overpayment: 10 });
  });
  it("carries forward only the unpaid remainder", () => {
    expect(carryForwardRemainder({ amountOwed: 60, amountPaid: 25, status: "Partial" })).toBe(35);
    expect(() => carryForwardRemainder({ amountOwed: 60, amountPaid: 60, status: "Settled" })).toThrow();
  });
  it("reverses every balance effect when a bill is deleted", () => {
    // Bill consumed +10 debt, then 5 overpaid (credit), nothing carried.
    expect(reversalDelta({ carryIn: 10, creditFromOverpayment: 5, carriedForward: 0 })).toBe(15);
    expect(reversalDelta({ carryIn: -20, creditFromOverpayment: 0, carriedForward: 7 })).toBe(-27);
  });
  it("plans receivables for housemates only", () => {
    const plans = planReceivables({ Alia: 40, Nana: 40, Alisa: 40 }, "Alia", { Nana: 5, Alisa: -10 });
    expect(plans.map((p) => [p.debtorName, p.amountOwed, p.newBalance])).toEqual([
      ["Nana", 45, 0],
      ["Alisa", 30, 0],
    ]);
  });
  it("aggregates statuses", () => {
    expect(aggregateStatus(["Settled", "Settled"])).toBe("Settled");
    expect(aggregateStatus(["Pending", "Settled"])).toBe("Partial");
    expect(aggregateStatus(["Pending", "Pending"])).toBe("Pending");
  });
});

describe("tariffs", () => {
  it("prices a small TNB bill with the EEI rebate and no retail charge", () => {
    const b = electricityCost(300, { ...DEFAULT_TARIFFS, includeKwtbb: false });
    // energy 81.09 + capacity 13.65 + network 38.55 − EEI 67.50
    expect(b.retail).toBe(0);
    expect(b.eei).toBe(-67.5);
    expect(b.total).toBeCloseTo(65.79, 2);
  });
  it("uses the higher energy rate above 1,500 kWh", () => {
    const b = electricityCost(1600, { ...DEFAULT_TARIFFS, includeEei: false, includeKwtbb: false, includeSst: false });
    expect(b.energy).toBeCloseTo(1500 * 0.2703 + 100 * 0.3703, 2);
    expect(b.retail).toBe(10);
  });
  it("prices water in blocks with a minimum charge", () => {
    expect(waterCost(5).total).toBe(6.5);
    expect(waterCost(30).total).toBeCloseTo(20 * 0.65 + 10 * 1.62, 2);
    expect(waterCost(40).total).toBeCloseTo(20 * 0.65 + 15 * 1.62 + 5 * 3.51, 2);
  });
});

function bill(sub: "Electric" | "Water", y: number, m: number, amount: number, units?: number): Transaction {
  return {
    id: `${sub}-${y}-${m}`,
    date: mytDate(y, m, 5),
    category: "House Bill",
    subCategory: sub,
    vendor: sub === "Electric" ? "TNB" : "Air Selangor",
    totalAmount: amount,
    consumptionUnits: units ?? null,
    isRecurring: false,
    status: "Pending",
  };
}

describe("utility analysis", () => {
  it("flags a bill more than 20% above the 90-day average", () => {
    const txs = [bill("Electric", 2026, 6, 100, 400), bill("Electric", 2026, 7, 110, 420), bill("Electric", 2026, 8, 105, 410), bill("Electric", 2026, 9, 140, 520)];
    const [a] = detectAnomalies(txs, { Electric: 0, Water: 0 });
    expect(a.isSpike).toBe(true);
    expect(a.avgCost).toBe(105);
  });
  it("does not flag normal variation", () => {
    const txs = [bill("Water", 2026, 7, 20), bill("Water", 2026, 8, 21), bill("Water", 2026, 9, 22)];
    const [a] = detectAnomalies(txs, { Electric: 0, Water: 0 });
    expect(a.isSpike).toBe(false);
  });
  it("forecasts the next month from recent history", () => {
    const txs = [bill("Electric", 2026, 7, 90), bill("Electric", 2026, 8, 120), bill("Electric", 2026, 9, 150)];
    const f = baselineForecast(txs, "Electric", mytDate(2026, 10, 7))!;
    // Latest bill is September, so the next bill to forecast is October.
    expect(f.targetMonth).toBe("2026-10");
    expect(f.amount).toBe(130); // (90*1 + 120*2 + 150*3) / 6
    expect(baselineForecast([...txs, bill("Electric", 2026, 10, 140)], "Electric", mytDate(2026, 10, 7))!.targetMonth).toBe("2026-11");
  });
  it("uses last year's seasonal change when available", () => {
    const txs = [bill("Electric", 2025, 9, 100), bill("Electric", 2025, 10, 130), bill("Electric", 2026, 7, 100), bill("Electric", 2026, 8, 100), bill("Electric", 2026, 9, 100)];
    const f = baselineForecast(txs, "Electric", mytDate(2026, 10, 7))!;
    expect(f.amount).toBe(112); // 0.6*100 + 0.4*100*1.3
  });
});

describe("dates and recurring", () => {
  it("clamps month shifts to the month length", () => {
    expect(monthKey(shiftMonths(mytDate(2026, 1, 31), 1))).toBe("2026-02");
  });
  it("generates the copy for this month once the recurrence day arrives", () => {
    const template = { id: "rent", date: mytDate(2026, 8, 1), dueDate: mytDate(2026, 8, 7), frequency: "Monthly" as const, recurrenceDay: 1, isRecurring: true };
    const occ = occurrenceFor(template, mytDate(2026, 10, 1))!;
    expect(occ.id).toBe("rent_2026-10");
    expect(occ.dueDate?.getTime()).toBe(mytDate(2026, 10, 7).getTime());
    expect(occurrenceFor(template, mytDate(2026, 8, 20))).toBeNull();
  });
  it("catches up on months missed while the app wasn't opened", () => {
    const template = { id: "rent", date: mytDate(2026, 6, 1), dueDate: null, frequency: "Monthly" as const, recurrenceDay: 5, isRecurring: true };
    // On 3 Oct the October copy isn't due yet; July–September are.
    expect(dueOccurrences(template, mytDate(2026, 10, 3)).map((o) => o.periodKey)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(dueOccurrences(template, mytDate(2026, 10, 5)).map((o) => o.periodKey)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(dueOccurrences(template, mytDate(2026, 10, 5), 2).map((o) => o.periodKey)).toEqual(["2026-09", "2026-10"]);
  });
  it("yearly bills only recur in their month", () => {
    const template = { id: "insurance", date: mytDate(2025, 10, 3), dueDate: null, frequency: "Yearly" as const, recurrenceDay: 3, isRecurring: true };
    expect(occurrenceFor(template, mytDate(2026, 9, 10))).toBeNull();
    expect(occurrenceFor(template, mytDate(2026, 10, 10))?.periodKey).toBe("2026-10");
  });
});

describe("statement import", () => {
  it("parses common date formats", () => {
    expect(monthKey(parseStatementDate("07/10/2026")!)).toBe("2026-10");
    expect(monthKey(parseStatementDate("2026-10-07")!)).toBe("2026-10");
    expect(monthKey(parseStatementDate("07 Oct 2026")!)).toBe("2026-10");
    expect(monthKey(parseStatementDate("07-OCT-26")!)).toBe("2026-10");
    expect(monthKey(parseStatementDate(46302)!)).toBe("2026-10");
  });
  it("parses bank amount formats", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("12.00 DR")).toBe(-12);
    expect(parseAmount("RM 5.00")).toBe(5);
    expect(parseAmount("abc")).toBeNull();
  });
  it("guesses categories from descriptions", () => {
    expect(guessCategory("JOMPAY TNB 12345", -120)).toEqual({ category: "House Bill", subCategory: "Electric" });
    expect(guessCategory("GRABFOOD MY", -25)).toEqual({ category: "Personal Expense", subCategory: "Food" });
    expect(guessCategory("DUITNOW TRANSFER NANA", 60).category).toBe("Income");
  });
});

describe("default splits per bill kind", () => {
  const settings = {
    defaultSplits: {
      Electric: { mode: "equal" as const, participants: ["Alia", "Nana"] },
      Rent: { mode: "fixed" as const, participants: people, fixedAmounts: { Nana: 450, Alisa: 500 } },
    },
  };
  it("uses the saved split for that kind, and everyone equally otherwise", () => {
    expect(defaultSplitDraft(settings, "Electric", people, "Alia").participants).toEqual(["Alia", "Nana"]);
    expect(defaultSplitDraft(settings, "Water", people, "Alia")).toMatchObject({ mode: "equal", participants: people });
    const rent = configFromDraft(defaultSplitDraft(settings, "Rent", people, "Alia"), people);
    expect(splitBill(1500, rent, "Alia")).toEqual({ Alia: 550, Nana: 450, Alisa: 500 });
  });
  it("ignores people who are no longer in the household", () => {
    const d = defaultSplitDraft({ defaultSplits: { Wifi: { mode: "equal", participants: ["Alia", "Old"] } } }, "Wifi", people, "Alia");
    expect(d.participants).toEqual(["Alia"]);
  });
  it("makes even percentages that total exactly 100", () => {
    expect(evenPercents(people)).toEqual({ Alia: "33.34", Nana: "33.33", Alisa: "33.33" });
  });
  it("describes a split in plain words", () => {
    expect(describeSplit(settings.defaultSplits.Electric, people)).toBe("Alia & Nana, equally");
    expect(describeSplit(settings.defaultSplits.Rent, people)).toBe("Nana RM450.00 · Alisa RM500.00 · Alia the rest");
  });
});

describe("estimator and messages", () => {
  it("estimates air-con energy from horsepower and duty cycle", () => {
    const kwh = monthlyKwh({ id: "a", name: "AC", type: "Electrical", quantity: 1, powerRatingWatts: 0, horsepower: 1, estimatedDailyHours: 8, dutyCyclePercent: 70, waterVolumeCubicMeters: 0, usesPerWeek: 0 });
    expect(kwh).toBeCloseTo((850 * 8 * 0.7 * 30) / 1000, 2);
  });
  it("estimates water from uses per week", () => {
    const m3 = monthlyWaterM3({ id: "w", name: "Washer", type: "Water", quantity: 1, powerRatingWatts: 0, estimatedDailyHours: 0, dutyCyclePercent: 100, waterVolumeCubicMeters: 0.08, usesPerWeek: 4 });
    expect(m3).toBeCloseTo((0.08 * 4 * 52) / 12, 2);
  });
  it("builds WhatsApp links for Malaysian numbers", () => {
    expect(normalisePhone("012-345 6789")).toBe("60123456789");
    expect(whatsappLink("60123456789", "Hi & bye")).toBe("https://wa.me/60123456789?text=Hi%20%26%20bye");
  });
});
