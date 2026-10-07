import { addDays, monthKey } from "./shared/dates";
import { round2 } from "./shared/money";
import { upcomingOccurrences } from "./shared/recurring";
import { outstanding } from "./shared/split";
import type { PaymentStatus, Receivable, Transaction } from "./shared/types";

export const STATUS_COLORS: Record<PaymentStatus, string> = {
  Pending: "#cf3f3f",
  Partial: "#c98a00",
  Settled: "#23885c",
};
export const PERSONAL_COLOR = "#5c6b85";
export const INCOME_COLOR = "#5b3fa8";

/** The admin's own cost of a house bill: her share if split, else the whole bill. */
export function adminCost(t: Transaction, adminName: string): number {
  if (t.category !== "House Bill") return 0;
  if (t.shares) return t.shares[adminName] ?? 0;
  return t.totalAmount;
}

export interface MonthSummary {
  income: number;
  personal: number;
  houseShare: number;
  net: number;
  houseTotal: number;
}

/**
 * Personal cash flow for a month. Shared bills count only the admin's share,
 * since what housemates owe is tracked separately as receivables.
 */
export function monthSummary(transactions: Transaction[], key: string, adminName: string): MonthSummary {
  let income = 0;
  let personal = 0;
  let houseShare = 0;
  let houseTotal = 0;
  for (const t of transactions) {
    if (monthKey(t.date) !== key) continue;
    if (t.category === "Income") income += t.totalAmount;
    else if (t.category === "Personal Expense") personal += t.totalAmount;
    else {
      houseShare += adminCost(t, adminName);
      houseTotal += t.totalAmount;
    }
  }
  return {
    income: round2(income),
    personal: round2(personal),
    houseShare: round2(houseShare),
    houseTotal: round2(houseTotal),
    net: round2(income - personal - houseShare),
  };
}

export interface HousemateSummary {
  name: string;
  outstanding: number;
  runningBalance: number;
  open: { receivable: Receivable; transaction: Transaction; due: number }[];
}

export function housemateSummaries(
  names: string[],
  receivables: Receivable[],
  transactions: Transaction[],
  balances: Record<string, number>,
): HousemateSummary[] {
  const txById = new Map(transactions.map((t) => [t.id, t]));
  return names.map((name) => {
    const open = receivables
      .filter((r) => r.debtorName === name && r.status !== "Settled")
      .map((r) => ({ receivable: r, transaction: txById.get(r.transactionId)!, due: outstanding(r) }))
      .filter((x) => x.transaction)
      .sort((a, b) => (a.transaction.dueDate ?? a.transaction.date).getTime() - (b.transaction.dueDate ?? b.transaction.date).getTime());
    return {
      name,
      outstanding: round2(open.reduce((s, x) => s + x.due, 0)),
      runningBalance: round2(balances[name] ?? 0),
      open,
    };
  });
}

export interface DueItem {
  id: string;
  label: string;
  amount: number;
  date: Date;
  status: PaymentStatus;
  overdue: boolean;
  projected: boolean;
}

/** Unsettled house bills due soon or overdue, plus recurring bills about to be generated. */
export function upcomingDue(transactions: Transaction[], now: Date, days = 14): DueItem[] {
  const until = addDays(now, days);
  const startOfToday = addDays(now, -1);
  const items: DueItem[] = [];
  for (const t of transactions) {
    if (t.category !== "House Bill" || t.status === "Settled") continue;
    const when = t.dueDate ?? t.date;
    if (when > until) continue;
    items.push({
      id: t.id,
      label: `${t.subCategory} · ${t.vendor}`,
      amount: t.totalAmount,
      date: when,
      status: t.status,
      overdue: when < startOfToday,
      projected: false,
    });
  }
  const existing = new Set(transactions.map((t) => t.id));
  for (const t of transactions.filter((x) => x.isRecurring)) {
    for (const occ of upcomingOccurrences(t, now, 1)) {
      if (existing.has(occ.id) || occ.date > until) continue;
      items.push({
        id: occ.id,
        label: `${t.subCategory} · ${t.vendor} (repeats)`,
        amount: t.totalAmount,
        date: occ.date,
        status: "Pending",
        overdue: false,
        projected: true,
      });
    }
  }
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}
