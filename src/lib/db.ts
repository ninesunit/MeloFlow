"use client";

/**
 * Firestore access for MeloFlow. Every operation that moves money between
 * a bill, its receivables and the running balances runs inside a Firestore
 * transaction, so the ledger never ends up half-updated.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Transaction as FsTransaction,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firestore, storage } from "./firebase";
import { isZero, round2 } from "./shared/money";
import {
  aggregateStatus,
  carryForwardRemainder,
  planReceivables,
  recordPayment,
  reversalDelta,
  splitBill,
  SplitError,
} from "./shared/split";
import type {
  Appliance,
  Balance,
  BalanceEvent,
  BalanceEventReason,
  PaymentStatus,
  Receivable,
  SplitConfig,
  Transaction,
  UserSettings,
} from "./shared/types";
import { defaultSettings } from "./shared/types";

export const COLLECTIONS = {
  transactions: "transactions",
  receivables: "receivables",
  balances: "balances",
  balanceEvents: "balanceEvents",
  userSettings: "userSettings",
  appliances: "appliances",
} as const;

export const SETTINGS_DOC_ID = "main";

// ---------- conversion ----------

/** Firestore Timestamps → Date, recursively. */
export function fromFirestore<T>(id: string, data: DocumentData): T {
  return { id, ...convertIn(data) } as T;
}

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

/** Date → Timestamp, drops `id` and undefined values. */
export function toFirestore(value: Record<string, unknown>): DocumentData {
  const { id: _id, ...rest } = value;
  void _id;
  return convertOut(rest) as DocumentData;
}

function convertOut(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(convertOut);
  if (value && typeof value === "object" && !(value instanceof Timestamp)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = convertOut(v);
    return out;
  }
  return value;
}

// ---------- subscriptions ----------

export function subscribe<T>(
  name: keyof typeof COLLECTIONS,
  onData: (items: T[]) => void,
  onError: (e: Error) => void,
  order?: string,
): () => void {
  const col = collection(firestore(), COLLECTIONS[name]);
  const q = order ? query(col, orderBy(order, "desc")) : col;
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => fromFirestore<T>(d.id, d.data()))),
    (e) => onError(e),
  );
}

export function subscribeSettings(onData: (s: UserSettings | null) => void, onError: (e: Error) => void) {
  return onSnapshot(
    doc(firestore(), COLLECTIONS.userSettings, SETTINGS_DOC_ID),
    (snap) => onData(snap.exists() ? fromFirestore<UserSettings>(snap.id, snap.data()) : null),
    (e) => onError(e),
  );
}

// ---------- settings ----------

/** Make sure the settings document exists and records the admin's uid. */
export async function ensureSettings(adminUid: string, existing: UserSettings | null): Promise<void> {
  const r = doc(firestore(), COLLECTIONS.userSettings, SETTINGS_DOC_ID);
  if (!existing) {
    await setDoc(r, toFirestore({ ...defaultSettings(adminUid), updatedAt: new Date() }));
  } else if (existing.adminUid !== adminUid) {
    await updateDoc(r, { adminUid, updatedAt: Timestamp.now() });
  }
}

export async function saveSettings(patch: Partial<UserSettings>): Promise<void> {
  const r = doc(firestore(), COLLECTIONS.userSettings, SETTINGS_DOC_ID);
  await setDoc(r, toFirestore({ ...patch, updatedAt: new Date() }), { merge: true });
}

// ---------- storage ----------

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-80);
}

export async function uploadFile(folder: "receipts" | "payment", file: File): Promise<{ url: string; path: string }> {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = `${folder}/${id}-${safeName(file.name || "upload")}`;
  const r = ref(storage(), path);
  await uploadBytes(r, file, { contentType: file.type || undefined });
  return { url: await getDownloadURL(r), path };
}

export async function deleteFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(ref(storage(), path));
  } catch {
    // Already gone, or never uploaded — nothing to do.
  }
}

// ---------- transactions ----------

export type TransactionInput = Omit<Transaction, "id" | "status" | "createdAt" | "updatedAt" | "shares" | "receivableIds">;

function newId(col: string): string {
  return doc(collection(firestore(), col)).id;
}

function balanceRef(name: string) {
  return doc(firestore(), COLLECTIONS.balances, name);
}

function logBalanceEvent(
  tx: FsTransaction,
  e: { debtorName: string; delta: number; balanceAfter: number; reason: BalanceEventReason; receivableId?: string | null; transactionId?: string | null; note?: string },
) {
  if (isZero(e.delta)) return;
  const r = doc(collection(firestore(), COLLECTIONS.balanceEvents));
  tx.set(r, toFirestore({ ...e, delta: round2(e.delta), balanceAfter: round2(e.balanceAfter), at: new Date() }));
}

/**
 * Create a transaction. Shared house bills with a split config also get one
 * receivable per housemate, with running balances applied.
 */
export async function createTransaction(input: TransactionInput, adminName: string, explicitId?: string): Promise<string> {
  const db = firestore();
  const id = explicitId ?? newId(COLLECTIONS.transactions);
  const now = new Date();

  if (input.category !== "House Bill" || !input.split) {
    const status: PaymentStatus = input.category === "House Bill" ? "Pending" : "Settled";
    await setDoc(
      doc(db, COLLECTIONS.transactions, id),
      toFirestore({ ...input, split: input.split ?? null, status, shares: null, receivableIds: [], createdAt: now, updatedAt: now }),
    );
    return id;
  }

  const split = input.split;
  const shares = splitBill(input.totalAmount, split, adminName);
  const debtors = Object.keys(shares).filter((n) => n !== adminName);

  await runTransaction(db, async (tx) => {
    const balances: Record<string, number> = {};
    for (const name of debtors) {
      const snap = await tx.get(balanceRef(name));
      balances[name] = snap.exists() ? Number(snap.data().runningBalance ?? 0) : 0;
    }
    const plans = planReceivables(shares, adminName, balances);
    const receivableIds = plans.map((p) => `${id}_${p.debtorName}`);
    const status = aggregateStatus(plans.map((p) => (p.amountOwed <= 0.005 ? "Settled" : "Pending")));

    tx.set(
      doc(db, COLLECTIONS.transactions, id),
      toFirestore({ ...input, split, shares, receivableIds, status, createdAt: now, updatedAt: now }),
    );
    for (const p of plans) {
      const rid = `${id}_${p.debtorName}`;
      const settled = p.amountOwed <= 0.005;
      const receivable: Omit<Receivable, "id"> = {
        transactionId: id,
        debtorName: p.debtorName,
        baseShare: p.baseShare,
        carryIn: p.carryIn,
        amountOwed: p.amountOwed,
        amountPaid: 0,
        status: settled ? "Settled" : "Pending",
        carriedForward: 0,
        creditFromOverpayment: 0,
        dueDate: input.dueDate ?? null,
        payments: [],
        createdAt: now,
        updatedAt: now,
      };
      tx.set(doc(db, COLLECTIONS.receivables, rid), toFirestore(receivable as unknown as Record<string, unknown>));
      if (!isZero(p.carryIn)) {
        tx.set(balanceRef(p.debtorName), toFirestore({ debtorName: p.debtorName, runningBalance: p.newBalance, updatedAt: now }));
        logBalanceEvent(tx, {
          debtorName: p.debtorName,
          delta: -p.carryIn,
          balanceAfter: p.newBalance,
          reason: "applied-to-bill",
          receivableId: rid,
          transactionId: id,
          note: `Applied to ${input.subCategory} (${input.vendor})`,
        });
      }
    }
  });
  return id;
}

/** Fields that can be edited without touching the money trail. */
export type EditableFields = Partial<
  Pick<
    Transaction,
    | "date"
    | "vendor"
    | "description"
    | "subCategory"
    | "consumptionUnits"
    | "billingPeriodStart"
    | "billingPeriodEnd"
    | "receiptUrl"
    | "receiptPath"
    | "dueDate"
    | "isRecurring"
    | "frequency"
    | "recurrenceDay"
  >
>;

export async function updateTransactionDetails(id: string, patch: EditableFields, receivableIds: string[] = []): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.transactions, id), toFirestore({ ...patch, updatedAt: new Date() }));
  if (patch.dueDate !== undefined) {
    for (const rid of receivableIds) {
      batch.update(doc(db, COLLECTIONS.receivables, rid), toFirestore({ dueDate: patch.dueDate, updatedAt: new Date() }));
    }
  }
  await batch.commit();
}

/**
 * Change the amount, category or split of a transaction. Allowed only while
 * no housemate has paid anything towards it, so the ledger stays consistent:
 * the old receivables are reversed and new ones created.
 */
export async function replaceTransaction(existing: Transaction, input: TransactionInput, adminName: string): Promise<void> {
  const db = firestore();
  const snaps = await Promise.all((existing.receivableIds ?? []).map((rid) => getDoc(doc(db, COLLECTIONS.receivables, rid))));
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const r = fromFirestore<Receivable>(snap.id, snap.data());
    if (r.amountPaid > 0 || r.carriedForward > 0) {
      throw new SplitError(
        `${r.debtorName} has already paid towards this bill, so its amount or split can't be changed. You can still edit the other details, or delete the bill and enter it again.`,
      );
    }
  }
  await deleteTransaction(existing, { keepReceipt: true });
  await createTransaction({ ...input }, adminName, existing.id);
}

/** Delete a transaction and undo everything its receivables did to running balances. */
export async function deleteTransaction(t: Transaction, opts: { keepReceipt?: boolean } = {}): Promise<void> {
  const db = firestore();
  const rids = t.receivableIds ?? [];
  await runTransaction(db, async (tx) => {
    const receivables: Receivable[] = [];
    for (const rid of rids) {
      const snap = await tx.get(doc(db, COLLECTIONS.receivables, rid));
      if (snap.exists()) receivables.push(fromFirestore<Receivable>(snap.id, snap.data()));
    }
    const deltas: Record<string, number> = {};
    for (const r of receivables) deltas[r.debtorName] = (deltas[r.debtorName] ?? 0) + reversalDelta(r);
    const current: Record<string, number> = {};
    for (const name of Object.keys(deltas)) {
      const snap = await tx.get(balanceRef(name));
      current[name] = snap.exists() ? Number(snap.data().runningBalance ?? 0) : 0;
    }
    // Writes after all reads.
    for (const [name, delta] of Object.entries(deltas)) {
      if (isZero(delta)) continue;
      const after = round2(current[name] + delta);
      tx.set(balanceRef(name), toFirestore({ debtorName: name, runningBalance: after, updatedAt: new Date() }));
      logBalanceEvent(tx, {
        debtorName: name,
        delta,
        balanceAfter: after,
        reason: "bill-deleted",
        transactionId: t.id,
        note: `Deleted ${t.subCategory} (${t.vendor})`,
      });
    }
    for (const r of receivables) tx.delete(doc(db, COLLECTIONS.receivables, r.id));
    tx.delete(doc(db, COLLECTIONS.transactions, t.id));
  });
  if (!opts.keepReceipt) await deleteFile(t.receiptPath);
}

/** Write many transactions at once (bank statement import). Skips hashes already present. */
export async function importTransactions(items: TransactionInput[]): Promise<{ written: number; skipped: number }> {
  const db = firestore();
  const existing = await getDocs(query(collection(db, COLLECTIONS.transactions), where("source", "==", "import")));
  const seen = new Set(existing.docs.map((d) => d.data().importHash as string).filter(Boolean));
  const fresh = items.filter((i) => !i.importHash || !seen.has(i.importHash));
  const now = new Date();
  for (let i = 0; i < fresh.length; i += 400) {
    const batch = writeBatch(db);
    for (const item of fresh.slice(i, i + 400)) {
      const status: PaymentStatus = item.category === "House Bill" ? "Pending" : "Settled";
      batch.set(
        doc(collection(db, COLLECTIONS.transactions)),
        toFirestore({ ...item, split: null, shares: null, receivableIds: [], status, createdAt: now, updatedAt: now }),
      );
    }
    await batch.commit();
  }
  return { written: fresh.length, skipped: items.length - fresh.length };
}

// ---------- settlement ----------

async function withReceivable(
  receivableId: string,
  fn: (ctx: {
    tx: FsTransaction;
    receivable: Receivable;
    transaction: Transaction;
    siblings: Receivable[];
    balance: number;
  }) => { receivable: Partial<Receivable>; balanceDelta: number; reason?: BalanceEventReason; note?: string },
): Promise<void> {
  const db = firestore();
  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(doc(db, COLLECTIONS.receivables, receivableId));
    if (!rSnap.exists()) throw new SplitError("This receivable no longer exists.");
    const receivable = fromFirestore<Receivable>(rSnap.id, rSnap.data());
    const tSnap = await tx.get(doc(db, COLLECTIONS.transactions, receivable.transactionId));
    if (!tSnap.exists()) throw new SplitError("The bill for this receivable was deleted.");
    const transaction = fromFirestore<Transaction>(tSnap.id, tSnap.data());
    const siblings: Receivable[] = [];
    for (const rid of transaction.receivableIds ?? []) {
      if (rid === receivableId) continue;
      const s = await tx.get(doc(db, COLLECTIONS.receivables, rid));
      if (s.exists()) siblings.push(fromFirestore<Receivable>(s.id, s.data()));
    }
    const bSnap = await tx.get(balanceRef(receivable.debtorName));
    const balance = bSnap.exists() ? Number(bSnap.data().runningBalance ?? 0) : 0;

    const result = fn({ tx, receivable, transaction, siblings, balance });
    const now = new Date();
    const updated = { ...receivable, ...result.receivable, updatedAt: now };
    tx.update(doc(db, COLLECTIONS.receivables, receivableId), toFirestore({ ...result.receivable, updatedAt: now }));
    tx.update(
      doc(db, COLLECTIONS.transactions, transaction.id),
      toFirestore({ status: aggregateStatus([updated.status, ...siblings.map((s) => s.status)]), updatedAt: now }),
    );
    if (!isZero(result.balanceDelta)) {
      const after = round2(balance + result.balanceDelta);
      tx.set(balanceRef(receivable.debtorName), toFirestore({ debtorName: receivable.debtorName, runningBalance: after, updatedAt: now }));
      logBalanceEvent(tx, {
        debtorName: receivable.debtorName,
        delta: result.balanceDelta,
        balanceAfter: after,
        reason: result.reason ?? "manual-adjustment",
        receivableId,
        transactionId: transaction.id,
        note: result.note,
      });
    }
  });
}

/** Record money received from a housemate. Overpayment becomes credit. */
export async function recordReceivablePayment(receivableId: string, amount: number, note?: string): Promise<void> {
  await withReceivable(receivableId, ({ receivable, transaction }) => {
    if (receivable.status === "Settled" && receivable.carriedForward > 0) {
      throw new SplitError("The remainder of this bill was carried forward; the payment will count against the next bill instead.");
    }
    const res = recordPayment(receivable, amount);
    return {
      receivable: {
        amountPaid: res.amountPaid,
        status: res.status,
        creditFromOverpayment: round2((receivable.creditFromOverpayment ?? 0) + res.overpayment),
        payments: [...(receivable.payments ?? []), { amount: round2(amount), at: new Date(), ...(note ? { note } : {}) }],
      },
      balanceDelta: -res.overpayment,
      reason: "overpayment",
      note: `Overpaid ${transaction.subCategory} (${transaction.vendor})`,
    };
  });
}

/** Mark the receivable fully paid (records a payment for whatever is outstanding). */
export async function settleReceivable(receivableId: string): Promise<void> {
  await withReceivable(receivableId, ({ receivable }) => {
    const due = round2(receivable.amountOwed - receivable.amountPaid);
    if (receivable.status === "Settled" || due <= 0) {
      return { receivable: { status: "Settled" }, balanceDelta: 0 };
    }
    return {
      receivable: {
        amountPaid: round2(receivable.amountPaid + due),
        status: "Settled",
        payments: [...(receivable.payments ?? []), { amount: due, at: new Date(), note: "Marked as settled" }],
      },
      balanceDelta: 0,
    };
  });
}

/** Close the receivable and move the unpaid remainder to the running balance. */
export async function carryForwardReceivable(receivableId: string): Promise<void> {
  await withReceivable(receivableId, ({ receivable, transaction }) => {
    const remainder = carryForwardRemainder(receivable);
    return {
      receivable: { status: "Settled", carriedForward: remainder },
      balanceDelta: remainder,
      reason: "carry-forward",
      note: `Unpaid remainder of ${transaction.subCategory} (${transaction.vendor})`,
    };
  });
}

/** Manually adjust a housemate's running balance (e.g. cash paid outside a bill). */
export async function adjustBalance(debtorName: string, delta: number, note: string): Promise<void> {
  const db = firestore();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(balanceRef(debtorName));
    const current = snap.exists() ? Number(snap.data().runningBalance ?? 0) : 0;
    const after = round2(current + delta);
    tx.set(balanceRef(debtorName), toFirestore({ debtorName, runningBalance: after, updatedAt: new Date() }));
    logBalanceEvent(tx, { debtorName, delta, balanceAfter: after, reason: "manual-adjustment", note });
  });
}

// ---------- appliances ----------

export async function saveAppliance(a: Omit<Appliance, "id"> & { id?: string }): Promise<void> {
  const db = firestore();
  const id = a.id ?? newId(COLLECTIONS.appliances);
  await setDoc(doc(db, COLLECTIONS.appliances, id), toFirestore({ ...a }));
}

export async function deleteAppliance(id: string): Promise<void> {
  await deleteDoc(doc(firestore(), COLLECTIONS.appliances, id));
}

export type { Balance, BalanceEvent, SplitConfig };
