/**
 * Utility consumption analysis: spike detection and a baseline forecast.
 * These deterministic numbers always work; the Gemini features add an
 * explanation and a second opinion on top of them.
 */
import { addDays, monthKey, mytDate, shiftMonths } from "./dates";
import { round2 } from "./money";
import type { Transaction } from "./types";

export type UtilityKind = "Electric" | "Water";
export const UTILITY_KINDS: UtilityKind[] = ["Electric", "Water"];

export function unitLabel(kind: UtilityKind): string {
  return kind === "Electric" ? "kWh" : "m³";
}

export function utilityBills(transactions: Transaction[], kind: UtilityKind): Transaction[] {
  return transactions
    .filter((t) => t.category === "House Bill" && t.subCategory === kind)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export interface AnomalyResult {
  kind: UtilityKind;
  bill: Transaction;
  /** Up to three earlier bills from the trailing ~3 months. */
  history: Transaction[];
  avgCost: number;
  avgUnits: number | null;
  costChange: number; // fraction, 0.25 = +25%
  unitsChange: number | null;
  isSpike: boolean;
  overCap: boolean;
  cap: number;
}

/** Compare the latest bill of each kind with its trailing 3-month average. */
export function detectAnomalies(
  transactions: Transaction[],
  caps: { Electric: number; Water: number },
  threshold = 0.2,
): AnomalyResult[] {
  const results: AnomalyResult[] = [];
  for (const kind of UTILITY_KINDS) {
    const bills = utilityBills(transactions, kind);
    if (bills.length === 0) continue;
    const current = bills[bills.length - 1];
    // Trailing three months: up to three earlier bills from roughly the last 90 days
    // (a 100-day window so monthly bills dated a few days apart still count).
    const windowStart = addDays(current.date, -100);
    const history = bills
      .filter((b) => b !== current && b.date >= windowStart && b.date < current.date)
      .slice(-3);
    const cap = caps?.[kind] ?? 0;
    const overCap = cap > 0 && current.totalAmount > cap;
    if (history.length === 0) {
      if (overCap) {
        results.push({
          kind,
          bill: current,
          history,
          avgCost: 0,
          avgUnits: null,
          costChange: 0,
          unitsChange: null,
          isSpike: false,
          overCap,
          cap,
        });
      }
      continue;
    }
    const avgCost = history.reduce((s, b) => s + b.totalAmount, 0) / history.length;
    const withUnits = history.filter((b) => typeof b.consumptionUnits === "number" && b.consumptionUnits! > 0);
    const avgUnits = withUnits.length
      ? withUnits.reduce((s, b) => s + (b.consumptionUnits as number), 0) / withUnits.length
      : null;
    const costChange = avgCost > 0 ? (current.totalAmount - avgCost) / avgCost : 0;
    const unitsChange =
      avgUnits && typeof current.consumptionUnits === "number" && current.consumptionUnits > 0
        ? (current.consumptionUnits - avgUnits) / avgUnits
        : null;
    const isSpike = costChange > threshold || (unitsChange !== null && unitsChange > threshold);
    results.push({
      kind,
      bill: current,
      history,
      avgCost: round2(avgCost),
      avgUnits: avgUnits === null ? null : round2(avgUnits),
      costChange,
      unitsChange,
      isSpike,
      overCap,
      cap,
    });
  }
  return results;
}

export interface BaselineForecast {
  kind: UtilityKind;
  targetMonth: string;
  amount: number;
  units: number | null;
  low: number;
  high: number;
  basis: string;
  historyCount: number;
}

/** One value per month (bills in the same month are added together). */
export function monthlySeries(bills: Transaction[]): { month: string; amount: number; units: number | null }[] {
  const map = new Map<string, { amount: number; units: number | null }>();
  for (const b of bills) {
    const key = monthKey(b.date);
    const entry = map.get(key) ?? { amount: 0, units: null };
    entry.amount += b.totalAmount;
    if (typeof b.consumptionUnits === "number") entry.units = (entry.units ?? 0) + b.consumptionUnits;
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, amount: round2(v.amount), units: v.units === null ? null : round2(v.units) }));
}

/**
 * Forecast next month's bill: a weighted average of the last three months
 * (3:2:1, newest heaviest), nudged by last year's month-to-month change
 * for the same season when that history exists.
 */
export function baselineForecast(transactions: Transaction[], kind: UtilityKind, now = new Date()): BaselineForecast | null {
  const series = monthlySeries(utilityBills(transactions, kind));
  if (series.length === 0) return null;
  // Forecast the next bill: the month after the latest one, but never a month already past.
  const latestKey = series[series.length - 1].month;
  const [ly, lm] = latestKey.split("-").map(Number);
  const afterLatest = monthKey(shiftMonths(mytDate(ly, lm, 15), 1));
  const current = monthKey(now);
  const target = afterLatest > current ? afterLatest : current;
  const [ty, tm] = target.split("-").map(Number);
  const targetDate = mytDate(ty, tm, 15);
  const recent = series.filter((s) => s.month < target).slice(-3);
  if (recent.length === 0) return null;

  const weights = [1, 2, 3].slice(3 - recent.length);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const wma = recent.reduce((s, r, i) => s + r.amount * weights[i], 0) / wsum;
  const unitsRecent = recent.filter((r) => r.units !== null);
  const unitWeights = [1, 2, 3].slice(3 - unitsRecent.length);
  const uwsum = unitWeights.reduce((a, b) => a + b, 0);
  const wmaUnits = unitsRecent.length
    ? unitsRecent.reduce((s, r, i) => s + (r.units as number) * unitWeights[i], 0) / uwsum
    : null;

  // Seasonal factor from last year: target month vs the month before it.
  const lastYearTarget = `${ty - 1}-${String(tm).padStart(2, "0")}`;
  const lastYearPrev = monthKey(shiftMonths(targetDate, -13));
  const a = series.find((s) => s.month === lastYearTarget);
  const b = series.find((s) => s.month === lastYearPrev);
  let amount = wma;
  let units = wmaUnits;
  let basis = `Weighted average of the last ${recent.length} month${recent.length > 1 ? "s" : ""}`;
  if (a && b && b.amount > 0) {
    const factor = Math.min(1.4, Math.max(0.7, a.amount / b.amount));
    const latest = recent[recent.length - 1];
    amount = 0.6 * wma + 0.4 * latest.amount * factor;
    if (units !== null && latest.units !== null) units = 0.6 * units + 0.4 * latest.units * factor;
    basis += `, adjusted ${factor >= 1 ? "+" : ""}${Math.round((factor - 1) * 100)}% for last year's seasonal change`;
  }

  const amounts = series.slice(-6).map((s) => s.amount);
  const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
  const sd = Math.sqrt(amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length);
  const spread = Math.max(sd, amount * 0.1);

  return {
    kind,
    targetMonth: target,
    amount: round2(amount),
    units: units === null ? null : round2(units),
    low: round2(Math.max(0, amount - spread)),
    high: round2(amount + spread),
    basis,
    historyCount: series.length,
  };
}
