"use client";

import { useMemo, useState } from "react";
import { BillDetail } from "@/components/BillDetail";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { TransactionForm } from "@/components/TransactionForm";
import { Button, cx, EmptyState, Input, Money, PageHeader, Select, StatusBadge } from "@/components/ui";
import { formatDate, formatMonth, monthKey } from "@/lib/shared/dates";
import { formatRM } from "@/lib/shared/money";
import type { Category, PaymentStatus } from "@/lib/shared/types";

type TypeFilter = "all" | Category;
type StatusFilter = "all" | PaymentStatus;

export default function BillsPage() {
  const { transactions, settings } = useData();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [month, setMonth] = useState<string>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const months = useMemo(() => [...new Set(transactions.map((t) => monthKey(t.date)))].sort().reverse(), [transactions]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return transactions
      .filter((t) => month === "all" || monthKey(t.date) === month)
      .filter((t) => type === "all" || t.category === type)
      .filter((t) => status === "all" || (t.category === "House Bill" && t.status === status))
      .filter((t) => !needle || `${t.vendor} ${t.subCategory} ${t.description ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transactions, q, month, type, status]);

  const totals = useMemo(() => {
    let inc = 0;
    let out = 0;
    for (const t of rows) {
      if (t.category === "Income") inc += t.totalAmount;
      else out += t.totalAmount;
    }
    return { inc, out };
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Bills & money"
        description="Every house bill, personal expense and income entry. Tap one to see who's paid."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> Add entry
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <Input aria-label="Search" placeholder="Search vendor, kind or note" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
          <option value="all">All types</option>
          <option value="House Bill">House bills</option>
          <option value="Personal Expense">Personal expenses</option>
          <option value="Income">Income</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">Any status</option>
          <option value="Pending">Pending</option>
          <option value="Partial">Partly paid</option>
          <option value="Settled">Settled</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={transactions.length ? "Nothing matches these filters" : "No entries yet"}
          action={
            !transactions.length && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add an entry
              </Button>
            )
          }
        >
          {transactions.length
            ? "Try another month or clear the search."
            : "Add a bill by hand or upload a photo of it. You can also import a bank statement from Import & export."}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full text-left text-[0.95rem]">
            <thead className="hidden border-b border-line bg-paper/60 text-sm text-ink-soft sm:table-header-group">
              <tr>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Entry</th>
                <th className="px-3 py-2.5 font-medium">Your share</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => {
                const mine = t.category === "House Bill" ? (t.shares ? t.shares[settings.adminName] ?? 0 : t.totalAmount) : null;
                return (
                  <tr key={t.id} onClick={() => setSelected(t.id)} className="cursor-pointer hover:bg-paper/50">
                    <td className="hidden px-5 py-3 whitespace-nowrap text-ink-soft sm:table-cell">{formatDate(t.date)}</td>
                    <td className="px-5 py-3 sm:px-3">
                      <button className="text-left font-medium focus-visible:underline" onClick={() => setSelected(t.id)}>
                        {t.vendor}
                      </button>
                      <p className="text-sm text-ink-soft">
                        {t.category === "House Bill" ? "House" : t.category === "Income" ? "Income" : "Personal"} · {t.subCategory}
                        {t.isRecurring && " · repeats"}
                        <span className="sm:hidden"> · {formatDate(t.date)}</span>
                      </p>
                    </td>
                    <td className="num hidden px-3 py-3 text-ink-soft sm:table-cell">{mine !== null ? formatRM(mine) : "—"}</td>
                    <td className="hidden px-3 py-3 sm:table-cell">{t.category === "House Bill" ? <StatusBadge status={t.status} /> : <span className="text-sm text-ink-faint">—</span>}</td>
                    <td className="px-5 py-3 text-right">
                      <Money value={t.category === "Income" ? t.totalAmount : -t.totalAmount} className={cx("font-medium", t.category === "Income" && "text-settled")} />
                      {t.category === "House Bill" && (
                        <div className="mt-1 sm:hidden">
                          <StatusBadge status={t.status} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-line bg-paper/60 text-sm">
              <tr>
                <td colSpan={5} className="px-5 py-3 text-right text-ink-soft">
                  {rows.length} entries · money in <span className="num font-medium text-ink">{formatRM(totals.inc)}</span> · money out{" "}
                  <span className="num font-medium text-ink">{formatRM(totals.out)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <TransactionForm open={adding} onClose={() => setAdding(false)} />
      <BillDetail transactionId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
