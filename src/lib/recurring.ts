"use client";

/**
 * Recurring bills without Cloud Functions: the dashboard calls this when it
 * opens. It writes any copies that are due (this month's once its day has
 * arrived, plus months missed while the app wasn't opened) straight to
 * Firestore. Each copy has a fixed id and is created inside a transaction
 * that first checks the id is free, so it can never be created twice.
 */
import { createTransaction, type TransactionInput } from "./db";
import { formatMonth } from "./shared/dates";
import { dueOccurrences } from "./shared/recurring";
import type { Transaction } from "./shared/types";

export interface RecurringResult {
  created: string[];
  failed: string[];
}

/** How far back to fill in missed months. */
export const CATCH_UP_MONTHS = 12;

let running: Promise<RecurringResult> | null = null;

/** Occurrences that are due but not in the loaded transactions yet. */
export function missingOccurrences(transactions: Transaction[], now = new Date()) {
  const existing = new Set(transactions.map((t) => t.id));
  return transactions
    .filter((t) => t.isRecurring)
    .flatMap((template) => dueOccurrences(template, now, CATCH_UP_MONTHS).filter((o) => !existing.has(o.id)).map((occ) => ({ template, occ })));
}

export function generateDueRecurringBills(transactions: Transaction[], adminName: string, now = new Date()): Promise<RecurringResult> {
  // One run at a time per tab (React may mount the dashboard twice in development).
  if (running) return running;
  running = (async () => {
    const result: RecurringResult = { created: [], failed: [] };
    for (const { template, occ } of missingOccurrences(transactions, now)) {
      const label = `${template.subCategory} (${template.vendor}) for ${formatMonth(occ.periodKey)}`;
      const input: TransactionInput = {
        date: occ.date,
        category: template.category,
        subCategory: template.subCategory,
        vendor: template.vendor,
        description: template.description ?? "",
        totalAmount: template.totalAmount,
        consumptionUnits: null,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        receiptFileId: null,
        dueDate: occ.dueDate,
        isRecurring: false,
        frequency: null,
        recurrenceDay: null,
        recurringSourceId: template.id,
        split: template.split ?? null,
        source: "recurring",
        importHash: null,
      };
      try {
        const id = await createTransaction(input, adminName, occ.id, { onlyIfMissing: true });
        if (id) result.created.push(label);
      } catch (e) {
        console.error(`Could not create recurring bill ${occ.id}`, e);
        result.failed.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
