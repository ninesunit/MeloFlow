/**
 * Smart split engine and running-balance arithmetic.
 *
 * Sign convention for running balances:
 *   runningBalance > 0  → the housemate still owes the admin from earlier bills
 *   runningBalance < 0  → the housemate has credit (paid too much before)
 *
 * All functions here are pure: they return the numbers to write and never
 * touch the database, which keeps them easy to test and reuse in Cloud Functions.
 */
import { fromSen, isZero, round2, toSen } from "./money";
import type { PaymentStatus, Receivable, SplitConfig } from "./types";

export class SplitError extends Error {}

/**
 * Percentages within this many points of 100 are accepted and scaled to
 * exactly 100% (so 33.33 + 33.33 + 33.33 works).
 */
export const PERCENT_TOLERANCE = 0.1;

/**
 * Divide a bill between participants. Results are exact to the sen and always
 * add up to the total. Leftover sen from rounding go to the first
 * participants in order (the admin is listed first, so she absorbs them).
 */
export function splitBill(total: number, config: SplitConfig, adminName: string): Record<string, number> {
  const people = config.participants.filter((p, i, arr) => p && arr.indexOf(p) === i);
  if (people.length === 0) throw new SplitError("Pick at least one person to split with.");
  const totalSen = toSen(total);
  if (totalSen < 0) throw new SplitError("The bill total cannot be negative.");

  const result: Record<string, number> = {};

  if (config.mode === "equal") {
    const base = Math.floor(totalSen / people.length);
    let leftover = totalSen - base * people.length;
    for (const p of people) {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      result[p] = fromSen(base + extra);
    }
    return result;
  }

  if (config.mode === "ratio") {
    const ratios = config.ratios ?? {};
    const weights = people.map((p) => Math.max(0, Number(ratios[p] ?? 0)));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw new SplitError("Enter a percentage for at least one person.");
    if (Math.abs(sum - 100) > PERCENT_TOLERANCE) throw new SplitError(`Percentages add up to ${round2(sum)}%, not 100%.`);
    // Scale to exactly 100% and use the largest-remainder method so the sen add
    // up exactly; ties go to the first participants (the admin is listed first).
    const raw = weights.map((w) => (totalSen * w) / sum);
    const floors = raw.map(Math.floor);
    let leftover = totalSen - floors.reduce((a, b) => a + b, 0);
    const order = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) {
      if (leftover <= 0) break;
      floors[i] += 1;
      leftover -= 1;
    }
    people.forEach((p, i) => (result[p] = fromSen(floors[i])));
    return result;
  }

  // fixed: housemates pay fixed amounts, the admin covers whatever is left.
  const fixed = config.fixedAmounts ?? {};
  let assigned = 0;
  for (const p of people) {
    if (p === adminName) continue;
    const sen = toSen(Math.max(0, Number(fixed[p] ?? 0)));
    result[p] = fromSen(sen);
    assigned += sen;
  }
  if (assigned > totalSen) {
    throw new SplitError("Fixed amounts are more than the bill total.");
  }
  if (people.includes(adminName)) {
    result[adminName] = fromSen(totalSen - assigned);
  } else if (assigned !== totalSen) {
    throw new SplitError(
      `Fixed amounts add up to ${fromSen(assigned).toFixed(2)} but the bill is ${fromSen(totalSen).toFixed(2)}. Include ${adminName} to cover the rest.`,
    );
  }
  // Keep participant order stable.
  const ordered: Record<string, number> = {};
  for (const p of people) ordered[p] = result[p] ?? 0;
  return ordered;
}

export interface CarryResult {
  /** Portion of the running balance used on this bill. */
  carryIn: number;
  amountOwed: number;
  /** Running balance left after this bill. */
  newBalance: number;
}

/**
 * Apply a housemate's running balance to a new share.
 * Debt is always added in full. Credit is used up to the size of the share,
 * and anything left over stays on the balance for the next bill.
 */
export function applyCarry(share: number, runningBalance: number): CarryResult {
  const shareSen = toSen(share);
  const balSen = toSen(runningBalance);
  const carrySen = balSen >= 0 ? balSen : Math.max(balSen, -shareSen);
  return {
    carryIn: fromSen(carrySen),
    amountOwed: fromSen(shareSen + carrySen),
    newBalance: fromSen(balSen - carrySen),
  };
}

export function statusFor(amountOwed: number, amountPaid: number): PaymentStatus {
  if (amountPaid >= amountOwed - 0.005) return "Settled";
  if (amountPaid > 0.005) return "Partial";
  return "Pending";
}

export interface PaymentResult {
  amountPaid: number;
  status: PaymentStatus;
  /** Money paid beyond what was owed; becomes credit on the running balance. */
  overpayment: number;
}

/** Record a payment against a receivable. */
export function recordPayment(r: Pick<Receivable, "amountOwed" | "amountPaid">, amount: number): PaymentResult {
  if (!(amount > 0)) throw new SplitError("Payment must be more than zero.");
  const owedSen = toSen(r.amountOwed);
  const paidBeforeSen = toSen(r.amountPaid);
  const paidSen = paidBeforeSen + toSen(amount);
  // Only the part of this payment above what was still owed counts as overpayment.
  const overSen = Math.max(0, paidSen - Math.max(owedSen, paidBeforeSen));
  return {
    amountPaid: fromSen(paidSen),
    status: statusFor(r.amountOwed, fromSen(paidSen)),
    overpayment: fromSen(overSen),
  };
}

/** Amount still unpaid on a receivable (never negative). */
export function outstanding(r: Pick<Receivable, "amountOwed" | "amountPaid" | "status">): number {
  if (r.status === "Settled") return 0;
  return Math.max(0, round2(r.amountOwed - r.amountPaid));
}

/**
 * Close a bill that was not fully paid and move the unpaid remainder onto
 * the running balance, so it is added to the housemate's next bill.
 */
export function carryForwardRemainder(r: Pick<Receivable, "amountOwed" | "amountPaid" | "status">): number {
  if (r.status === "Settled") throw new SplitError("This bill is already settled.");
  const remainder = round2(r.amountOwed - r.amountPaid);
  if (remainder <= 0) throw new SplitError("Nothing left to carry forward.");
  return remainder;
}

/**
 * The change to apply to the running balance if a receivable is deleted,
 * undoing everything it did to the balance:
 *   + carryIn                 (give back the debt/credit it consumed)
 *   + creditFromOverpayment   (remove credit it created)
 *   − carriedForward          (remove debt it pushed forward)
 * Note: this returns the delta that restores the balance; credit was stored
 * as a negative balance, so removing it means adding it back.
 */
export function reversalDelta(r: Pick<Receivable, "carryIn" | "creditFromOverpayment" | "carriedForward">): number {
  return round2((r.carryIn ?? 0) + (r.creditFromOverpayment ?? 0) - (r.carriedForward ?? 0));
}

/** Overall status of a bill from its receivables. */
export function aggregateStatus(statuses: PaymentStatus[]): PaymentStatus {
  if (statuses.length === 0) return "Pending";
  if (statuses.every((s) => s === "Settled")) return "Settled";
  if (statuses.every((s) => s === "Pending")) return "Pending";
  return "Partial";
}

export interface PlannedReceivable {
  debtorName: string;
  baseShare: number;
  carryIn: number;
  amountOwed: number;
  newBalance: number;
}

/**
 * Plan the receivables for a shared bill: one per housemate (everyone in the
 * split except the admin), each with their running balance applied.
 */
export function planReceivables(
  shares: Record<string, number>,
  adminName: string,
  balances: Record<string, number>,
): PlannedReceivable[] {
  const plans: PlannedReceivable[] = [];
  for (const [name, share] of Object.entries(shares)) {
    if (name === adminName) continue;
    const carry = applyCarry(share, balances[name] ?? 0);
    if (isZero(share) && isZero(carry.amountOwed)) continue;
    plans.push({ debtorName: name, baseShare: share, ...carry });
  }
  return plans;
}
