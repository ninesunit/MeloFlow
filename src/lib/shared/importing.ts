/**
 * Helpers for importing bank statements exported as Excel or CSV.
 * Malaysian banks use different layouts, so the import screen lets you map
 * columns; these functions turn the raw cell values into clean records.
 */
import { mytDate } from "./dates";
import { round2 } from "./money";
import type { Category } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export type DateOrder = "dmy" | "mdy" | "ymd";

/** Parse a statement date: Excel serial numbers, Date objects, 07/10/2026, 2026-10-07, 07 Oct 2026, 07-OCT-26. */
export function parseStatementDate(value: unknown, order: DateOrder = "dmy"): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return mytDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30).
    if (value > 20000 && value < 80000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return mytDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return safe(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    if (order === "mdy") return safe(y, a, b);
    return safe(y, b, a);
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[A-Za-z]*[\s-,]*(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return safe(fullYear(Number(m[3])), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /^([A-Za-z]{3,4})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return safe(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  return null;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function safe(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return mytDate(y, m, d);
}

/** Parse "1,234.50", "(12.00)", "12.00 DR", "RM 5.00", "-3.10" into a number. */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s) || /-$/.test(s)) negative = true;
  s = s.replace(/RM|MYR|CR|DR/gi, "").replace(/[,\s]/g, "").replace(/-$/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

export interface CategoryGuess {
  category: Category;
  subCategory: string;
}

const HOUSE_RULES: [RegExp, string][] = [
  [/\bTNB\b|TENAGA/i, "Electric"],
  [/AIR SELANGOR|SYABAS|PENGURUSAN AIR|\bSAJ\b|\bPBA\b|INDAH WATER|\bIWK\b/i, "Water"],
  [/UNIFI|\bTIME\b.*(FIBRE|INTERNET|DOTCOM)|MAXIS ?FIBRE|CELCOMDIGI ?FIBRE|ASTRO ?FIBRE|YES ?4G/i, "Wifi"],
  [/\bRENT|SEWA\b/i, "Rent"],
  [/\bLPG\b|GAS (MALAYSIA|CYLINDER|TONG)|\bGASMALAYSIA\b/i, "Gas"],
];

const PERSONAL_RULES: [RegExp, string][] = [
  [/GRAB ?FOOD|FOODPANDA|SHOPEEFOOD|MCD|MCDONALD|KFC|STARBUCKS|ZUS|TEALIVE|RESTORAN|NASI|MAMAK|CAFE|BAKERY/i, "Food"],
  [/LOTUS|AEON|MYDIN|GIANT|JAYA GROCER|VILLAGE GROCER|NSK|99 SPEEDMART|KK MART|7-ELEVEN|FAMILYMART/i, "Groceries"],
  [/GRAB(?! ?FOOD)|TNG|TOUCH ?N ?GO|PETRONAS|SHELL|PETRON|CALTEX|BHPETROL|PARKING|RAPID|MRT|LRT|KTM|AIRASIA|BOLT/i, "Transport"],
  [/SHOPEE|LAZADA|TIKTOK ?SHOP|UNIQLO|ZALORA|IKEA|MR ?DIY/i, "Shopping"],
  [/HOTLINK|DIGI|CELCOM|MAXIS|U ?MOBILE|YOODO|TUNE ?TALK|PREPAID|POSTPAID/i, "Phone"],
  [/CLINIC|KLINIK|PHARMACY|FARMASI|GUARDIAN|WATSONS|HOSPITAL/i, "Health"],
  [/MMU|UNIVERSITI|UNIVERSITY|COLLEGE|PTPTN|BOOK|POPULAR|MPH/i, "Education"],
  [/NETFLIX|SPOTIFY|YOUTUBE|DISNEY|APPLE\.COM|GOOGLE|ICLOUD|CHATGPT|OPENAI|ANTHROPIC|CANVA/i, "Subscriptions"],
  [/CINEMA|\bGSC\b|\bTGV\b|STEAM|PLAYSTATION|NINTENDO/i, "Entertainment"],
];

const INCOME_RULES: [RegExp, string][] = [
  [/SALARY|GAJI|PAYROLL/i, "Salary"],
  [/ALLOWANCE|ELAUN|PTPTN|BIASISWA|SCHOLARSHIP|MARA|JPA/i, "Allowance"],
  [/REFUND|REVERSAL|CASHBACK/i, "Refund"],
];

/** Quick keyword guess; the AI categoriser can refine it. Money in → Income. */
export function guessCategory(description: string, amount: number): CategoryGuess {
  const d = description ?? "";
  if (amount > 0) {
    for (const [re, sub] of INCOME_RULES) if (re.test(d)) return { category: "Income", subCategory: sub };
    return { category: "Income", subCategory: "Miscellaneous" };
  }
  for (const [re, sub] of HOUSE_RULES) if (re.test(d)) return { category: "House Bill", subCategory: sub };
  for (const [re, sub] of PERSONAL_RULES) if (re.test(d)) return { category: "Personal Expense", subCategory: sub };
  return { category: "Personal Expense", subCategory: "Miscellaneous" };
}

/** Stable key for spotting a statement line that was already imported. */
export function importHash(date: Date, description: string, amount: number): string {
  const raw = `${date.toISOString().slice(0, 10)}|${description.trim().toUpperCase().replace(/\s+/g, " ")}|${round2(amount).toFixed(2)}`;
  // djb2 — small, deterministic, good enough for de-duplication.
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return `imp_${(h >>> 0).toString(36)}_${raw.length}`;
}
