/**
 * Recurring bill scheduling. A transaction with isRecurring = true is a
 * template; each period gets one generated copy with a predictable id
 * (`<templateId>_<YYYY-MM>`), so running the generator twice — or from two
 * tabs at once — never creates duplicates. The app runs it in the browser
 * when the dashboard opens (no Cloud Functions needed).
 */
import { addDays, daysBetween, daysInMonth, monthKey, mytDate, mytParts } from "./dates";
import type { Transaction } from "./types";

export interface Occurrence {
  id: string;
  periodKey: string;
  date: Date;
  dueDate: Date | null;
}

export function recurrenceDayOf(t: Pick<Transaction, "recurrenceDay" | "date">): number {
  const day = t.recurrenceDay ?? mytParts(t.date).day;
  return Math.min(28, Math.max(1, Math.round(day)));
}

/**
 * The occurrence that should exist for the month containing `today`, or null
 * if it is not yet the recurrence day, the template's own month, or (yearly)
 * the wrong month.
 */
export function occurrenceFor(
  template: Pick<Transaction, "id" | "date" | "dueDate" | "frequency" | "recurrenceDay" | "isRecurring">,
  today: Date,
): Occurrence | null {
  if (!template.isRecurring) return null;
  const now = mytParts(today);
  const start = mytParts(template.date);
  const day = recurrenceDayOf(template);

  if (now.year * 12 + now.month <= start.year * 12 + start.month) return null;
  if (template.frequency === "Yearly" && now.month !== start.month) return null;
  if (now.day < day) return null;

  const date = mytDate(now.year, now.month, Math.min(day, daysInMonth(now.year, now.month)));
  const dueOffset = template.dueDate ? daysBetween(template.date, template.dueDate) : null;
  const periodKey = monthKey(date);
  return {
    id: `${template.id}_${periodKey}`,
    periodKey,
    date,
    dueDate: dueOffset === null ? null : addDays(date, dueOffset),
  };
}

/** Upcoming occurrence dates within the next `months` months, for the calendar preview. */
export function upcomingOccurrences(
  template: Pick<Transaction, "id" | "date" | "dueDate" | "frequency" | "recurrenceDay" | "isRecurring">,
  from: Date,
  months: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  const { year, month } = mytParts(from);
  for (let i = 0; i <= months; i++) {
    const total = year * 12 + (month - 1) + i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    // Probe the last day of each month so the recurrence day has passed.
    const probe = mytDate(y, m, daysInMonth(y, m));
    const occ = occurrenceFor(template, probe);
    if (occ && occ.date >= from) out.push(occ);
  }
  return out;
}

/**
 * Every occurrence that should already exist by `today`: this month's (once its
 * day has arrived) plus any earlier months that were missed because the app
 * wasn't opened, going back at most `maxMonths` months.
 */
export function dueOccurrences(
  template: Pick<Transaction, "id" | "date" | "dueDate" | "frequency" | "recurrenceDay" | "isRecurring">,
  today: Date,
  maxMonths = 12,
): Occurrence[] {
  const out: Occurrence[] = [];
  const { year, month } = mytParts(today);
  for (let i = maxMonths - 1; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    // For past months, probe the month's last day; for this month, probe today.
    const probe = i === 0 ? today : mytDate(y, m, daysInMonth(y, m));
    const occ = occurrenceFor(template, probe);
    if (occ) out.push(occ);
  }
  return out;
}
