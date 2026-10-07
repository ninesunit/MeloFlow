import { FieldValue, getFirestore, Timestamp, type DocumentData, type Transaction as FsTransaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION, requireAdmin, TIME_ZONE } from "./config";
import type { RunRecurringResponse } from "./shared/ai-types";
import { isZero, round2 } from "./shared/money";
import { occurrenceFor } from "./shared/recurring";
import { aggregateStatus, planReceivables, splitBill } from "./shared/split";
import type { Transaction } from "./shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns whatever shape the document has
function convertIn(value: unknown): any {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(convertIn);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convertIn(v);
    return out;
  }
  return value;
}

function convertOut(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(convertOut);
  if (value && typeof value === "object" && !(value instanceof Timestamp) && !(value instanceof FieldValue)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = convertOut(v);
    return out;
  }
  return value;
}

function toTransaction(id: string, data: DocumentData): Transaction {
  return { id, ...convertIn(data) } as Transaction;
}

/**
 * Create this month's copy of every recurring bill whose day has arrived.
 * Each copy has the id `<templateId>_<YYYY-MM>`, so it is created only once.
 * Shared house bills get receivables with running balances carried over.
 */
export async function generateRecurring(now = new Date()): Promise<RunRecurringResponse> {
  const db = getFirestore();
  const settingsSnap = await db.collection("userSettings").doc("main").get();
  const adminName: string = settingsSnap.exists ? settingsSnap.data()?.adminName || "Alia" : "Alia";

  const templates = await db.collection("transactions").where("isRecurring", "==", true).get();
  const result: RunRecurringResponse = { created: 0, skipped: 0, details: [] };

  for (const snap of templates.docs) {
    const template = toTransaction(snap.id, snap.data());
    const occ = occurrenceFor(template, now);
    if (!occ) continue;
    const ref = db.collection("transactions").doc(occ.id);

    try {
      const created = await db.runTransaction(async (tx: FsTransaction) => {
        const existing = await tx.get(ref);
        if (existing.exists) return false;

        const base: Record<string, unknown> = {
          date: occ.date,
          category: template.category,
          subCategory: template.subCategory,
          vendor: template.vendor,
          description: template.description ?? "",
          totalAmount: template.totalAmount,
          consumptionUnits: null,
          billingPeriodStart: null,
          billingPeriodEnd: null,
          receiptUrl: null,
          receiptPath: null,
          dueDate: occ.dueDate,
          isRecurring: false,
          frequency: null,
          recurrenceDay: null,
          recurringSourceId: template.id,
          source: "recurring",
          createdAt: now,
          updatedAt: now,
        };

        if (template.category !== "House Bill" || !template.split) {
          tx.set(ref, convertOut({ ...base, split: template.split ?? null, shares: null, receivableIds: [], status: template.category === "House Bill" ? "Pending" : "Settled" }) as DocumentData);
          return true;
        }

        const shares = splitBill(template.totalAmount, template.split, adminName);
        const debtors = Object.keys(shares).filter((n) => n !== adminName);
        const balances: Record<string, number> = {};
        for (const name of debtors) {
          const b = await tx.get(db.collection("balances").doc(name));
          balances[name] = b.exists ? Number(b.data()?.runningBalance ?? 0) : 0;
        }
        const plans = planReceivables(shares, adminName, balances);
        const receivableIds = plans.map((p) => `${occ.id}_${p.debtorName}`);
        const status = aggregateStatus(plans.map((p) => (p.amountOwed <= 0.005 ? "Settled" : "Pending")));

        tx.set(ref, convertOut({ ...base, split: template.split, shares, receivableIds, status }) as DocumentData);
        for (const p of plans) {
          const rid = `${occ.id}_${p.debtorName}`;
          tx.set(
            db.collection("receivables").doc(rid),
            convertOut({
              transactionId: occ.id,
              debtorName: p.debtorName,
              baseShare: p.baseShare,
              carryIn: p.carryIn,
              amountOwed: p.amountOwed,
              amountPaid: 0,
              status: p.amountOwed <= 0.005 ? "Settled" : "Pending",
              carriedForward: 0,
              creditFromOverpayment: 0,
              dueDate: occ.dueDate,
              payments: [],
              createdAt: now,
              updatedAt: now,
            }) as DocumentData,
          );
          if (!isZero(p.carryIn)) {
            tx.set(db.collection("balances").doc(p.debtorName), convertOut({ debtorName: p.debtorName, runningBalance: p.newBalance, updatedAt: now }) as DocumentData);
            tx.set(
              db.collection("balanceEvents").doc(),
              convertOut({
                debtorName: p.debtorName,
                delta: round2(-p.carryIn),
                balanceAfter: round2(p.newBalance),
                reason: "applied-to-bill",
                receivableId: rid,
                transactionId: occ.id,
                note: `Applied to ${template.subCategory} (${template.vendor}) — recurring`,
                at: now,
              }) as DocumentData,
            );
          }
        }
        return true;
      });
      if (created) {
        result.created += 1;
        result.details.push(`Created ${template.subCategory} – ${template.vendor} for ${occ.periodKey}`);
      } else {
        result.skipped += 1;
      }
    } catch (e) {
      logger.error(`Could not generate recurring bill from ${template.id}`, e);
      result.details.push(`Failed: ${template.subCategory} – ${template.vendor} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  logger.info("Recurring bills", result);
  return result;
}

/** Runs every day shortly after midnight Malaysia time. */
export const generateRecurringBills = onSchedule(
  { schedule: "10 0 * * *", timeZone: TIME_ZONE, region: REGION, retryCount: 1 },
  async () => {
    await generateRecurring();
  },
);

/** Lets the admin run the generator immediately from Settings. */
export const runRecurringNow = onCall({ region: REGION }, async (request): Promise<RunRecurringResponse> => {
  requireAdmin(request);
  return generateRecurring();
});
