"use client";

import * as XLSX from "xlsx";
import { toDateInput } from "./shared/dates";
import type { BalanceEvent, Receivable, Transaction } from "./shared/types";

export interface SheetData {
  name: string;
  rows: unknown[][];
}

/** Read every sheet of an .xlsx / .xls / .csv file as rows of raw cell values. */
export async function readWorkbook(file: File): Promise<SheetData[]> {
  const buf = await file.arrayBuffer();
  // raw: keep CSV text as text, so 01/10/2026 isn't read as 10 January by SheetJS's US-style guesser.
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: true, dense: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false, defval: "" }),
  }));
}

/** Guess the header row: the first row in the top 25 that mentions a date and a description or amount. */
export function guessHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const cells = rows[i].map((c) => String(c ?? "").toLowerCase());
    const hasDate = cells.some((c) => /date|tarikh/.test(c));
    const hasOther = cells.some((c) => /desc|details|particular|transaction|keterangan|amount|debit|credit|withdraw|deposit/.test(c));
    if (hasDate && hasOther) return i;
  }
  return 0;
}

export function guessColumn(headers: string[], patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = headers.findIndex((h) => re.test(h.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

const d = (x: Date | null | undefined) => (x ? toDateInput(x) : "");

/** One workbook with separate sheets for personal money, house bills, receivables and balances. */
export function exportWorkbook(opts: {
  transactions: Transaction[];
  receivables: Receivable[];
  balances: Record<string, number>;
  balanceEvents: BalanceEvent[];
  housemates: string[];
  adminName: string;
}) {
  const { transactions, receivables, balances, balanceEvents, housemates, adminName } = opts;
  const byDate = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
  const txById = new Map(transactions.map((t) => [t.id, t]));

  const personal = byDate
    .filter((t) => t.category !== "House Bill")
    .map((t) => ({
      Date: d(t.date),
      Type: t.category,
      Category: t.subCategory,
      "Paid to / from": t.vendor,
      Note: t.description ?? "",
      "Money in (RM)": t.category === "Income" ? t.totalAmount : null,
      "Money out (RM)": t.category === "Personal Expense" ? t.totalAmount : null,
      Repeats: t.isRecurring ? t.frequency : "",
      Receipt: t.receiptUrl ?? "",
    }));

  const house = byDate
    .filter((t) => t.category === "House Bill")
    .map((t) => {
      const row: Record<string, unknown> = {
        Date: d(t.date),
        "Due date": d(t.dueDate),
        Kind: t.subCategory,
        Vendor: t.vendor,
        "Total (RM)": t.totalAmount,
        Usage: t.consumptionUnits ?? null,
        Unit: t.subCategory === "Electric" ? "kWh" : t.subCategory === "Water" ? "m³" : "",
        "Split method": t.split ? { equal: "Equal", ratio: "Percentage", fixed: "Fixed amounts" }[t.split.mode] : "Not split",
        [`${adminName}'s share (RM)`]: t.shares ? t.shares[adminName] ?? 0 : t.totalAmount,
      };
      for (const h of housemates) row[`${h}'s share (RM)`] = t.shares?.[h] ?? null;
      row.Status = t.status;
      row.Repeats = t.isRecurring ? t.frequency : "";
      row.Receipt = t.receiptUrl ?? "";
      return row;
    });

  const ledger = [...receivables]
    .sort((a, b) => (txById.get(a.transactionId)?.date.getTime() ?? 0) - (txById.get(b.transactionId)?.date.getTime() ?? 0))
    .map((r) => {
      const t = txById.get(r.transactionId);
      return {
        "Bill date": d(t?.date),
        Bill: t ? `${t.subCategory} – ${t.vendor}` : r.transactionId,
        Housemate: r.debtorName,
        "Share (RM)": r.baseShare,
        "Carried in (RM)": r.carryIn,
        "Owed (RM)": r.amountOwed,
        "Paid (RM)": r.amountPaid,
        "Carried forward (RM)": r.carriedForward,
        "Overpaid as credit (RM)": r.creditFromOverpayment,
        Status: r.status,
        "Due date": d(r.dueDate),
        "Last updated": d(r.updatedAt),
        Payments: (r.payments ?? []).map((p) => `${d(p.at)} RM${p.amount.toFixed(2)}${p.note ? ` (${p.note})` : ""}`).join("; "),
      };
    });

  const balanceRows: unknown[][] = [["Housemate", "Running balance (RM)", "Meaning"]];
  for (const h of housemates) {
    const b = balances[h] ?? 0;
    balanceRows.push([h, b, b > 0 ? "Owes — added to next bill" : b < 0 ? "Credit — taken off next bill" : "Nothing carried over"]);
  }
  balanceRows.push([], ["History"], ["Date", "Housemate", "Change (RM)", "Balance after (RM)", "Reason", "Note"]);
  for (const e of [...balanceEvents].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    balanceRows.push([d(e.at), e.debtorName, e.delta, e.balanceAfter, e.reason, e.note ?? ""]);
  }

  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[], empty: string) => {
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([[empty]]);
    if (rows.length) ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(10, Math.min(40, k.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add("Personal Finances", personal, "No personal entries yet");
  add("House Bills", house, "No house bills yet");
  add("Receivables Ledger", ledger, "No receivables yet");
  const bs = XLSX.utils.aoa_to_sheet(balanceRows);
  bs["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, bs, "Running Balances");

  XLSX.writeFile(wb, `MeloFlow-${toDateInput(new Date())}.xlsx`, { compression: true });
}
