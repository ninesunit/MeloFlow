/**
 * Date helpers pinned to Malaysia time (UTC+8, no daylight saving),
 * so the app and the scheduled Cloud Function agree on what "today" is.
 */

export const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Year, month (1–12) and day in Malaysia time. */
export function mytParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + MYT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Midnight Malaysia time on the given calendar date, as an absolute Date. */
export function mytDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - MYT_OFFSET_MS);
}

/** "2026-10" style key for a month in Malaysia time. */
export function monthKey(date: Date): string {
  const { year, month } = mytParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Same day-of-month in another month, clamped to that month's length. */
export function shiftMonths(date: Date, months: number): Date {
  const { year, month, day } = mytParts(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return mytDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** "2026-10-07" in Malaysia time, for <input type="date">. */
export function toDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  const { year, month, day } = mytParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse "2026-10-07" as midnight Malaysia time. Returns null for blank/invalid input. */
export function fromDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return mytDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  const { year, month, day } = mytParts(date);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${names[month - 1]} ${year}`;
}

export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[m - 1]} ${y}`;
}
