"use client";

import { useState } from "react";
import { deleteTransaction } from "@/lib/db";
import { formatDate } from "@/lib/shared/dates";
import { formatRM, isZero } from "@/lib/shared/money";
import type { Transaction } from "@/lib/shared/types";
import { Icon } from "./icons";
import { useData } from "./providers/DataProvider";
import { errorText, useToast } from "./providers/ToastProvider";
import { ReceivableActions } from "./ReceivableActions";
import { TransactionForm } from "./TransactionForm";
import { Button, Dialog, Money, StatusBadge } from "./ui";

/** Full view of one entry: details, each housemate's share, and payment actions. */
export function BillDetail({ transactionId, onClose }: { transactionId: string | null; onClose: () => void }) {
  const { transactions, receivablesByTx, settings } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const t = transactions.find((x) => x.id === transactionId) ?? null;
  if (!transactionId) return null;
  if (!t) return null;
  const receivables = (receivablesByTx.get(t.id) ?? []).sort((a, b) => a.debtorName.localeCompare(b.debtorName));
  const unit = t.subCategory === "Electric" ? "kWh" : t.subCategory === "Water" ? "m³" : "";
  const template = t.recurringSourceId ? transactions.find((x) => x.id === t.recurringSourceId) : null;

  async function remove(tx: Transaction) {
    const paid = receivables.some((r) => r.amountPaid > 0);
    const msg = paid
      ? "Payments have been recorded for this bill. Deleting it also removes those payments and undoes its effect on running balances. Delete anyway?"
      : "Delete this entry? Any running-balance adjustments it made will be undone.";
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      await deleteTransaction(tx);
      toast("Deleted");
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={!editing}
        onClose={onClose}
        wide
        title={`${t.subCategory} · ${t.vendor}`}
        footer={
          <>
            <Button variant="danger" busy={deleting} onClick={() => remove(t)}>
              <Icon name="trash" className="h-4 w-4" /> Delete
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Icon name="edit" className="h-4 w-4" /> Edit
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-ink-soft">{t.category === "House Bill" ? "Shared house bill" : t.category}</p>
              <p className="num text-[2rem] leading-tight font-semibold">{formatRM(t.totalAmount)}</p>
            </div>
            {t.category === "House Bill" && <StatusBadge status={t.status} />}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Detail label="Date" value={formatDate(t.date)} />
            {t.dueDate && <Detail label="Due" value={formatDate(t.dueDate)} />}
            {t.consumptionUnits != null && <Detail label="Usage" value={`${t.consumptionUnits} ${unit}`} />}
            {t.billingPeriodStart && t.billingPeriodEnd && (
              <Detail label="Billing period" value={`${formatDate(t.billingPeriodStart)} – ${formatDate(t.billingPeriodEnd)}`} />
            )}
            {t.isRecurring && <Detail label="Repeats" value={`${t.frequency === "Yearly" ? "Yearly" : "Monthly"} on day ${t.recurrenceDay}`} />}
            {template && <Detail label="Created from" value={`Recurring ${template.subCategory.toLowerCase()} bill`} />}
            {t.description && <Detail label="Note" value={t.description} />}
            {t.receiptUrl && (
              <div>
                <dt className="text-ink-faint">Receipt</dt>
                <dd>
                  <a href={t.receiptUrl} target="_blank" rel="noreferrer" className="text-violet underline">
                    Open file
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {t.shares && (
            <div>
              <h3 className="mb-2 font-semibold">Who pays what</h3>
              <div className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
                {Object.entries(t.shares).map(([name, share]) => {
                  const r = receivables.find((x) => x.debtorName === name);
                  if (name === settings.adminName || !r) {
                    return (
                      <div key={name} className="flex items-center justify-between px-4 py-3">
                        <span className="font-medium">{name}</span>
                        <Money value={share} />
                      </div>
                    );
                  }
                  return (
                    <div key={name} className="flex flex-col gap-3 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{name}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="num text-right text-sm">
                          <span className="text-ink-soft">share </span>
                          {formatRM(r.baseShare)}
                          {!isZero(r.carryIn) && (
                            <span className="text-ink-soft"> {r.carryIn > 0 ? `+ ${formatRM(r.carryIn)} carried` : `− ${formatRM(-r.carryIn)} credit`}</span>
                          )}
                          <span className="text-ink-soft"> · paid </span>
                          {formatRM(r.amountPaid)}
                          <span className="text-ink-soft"> of </span>
                          <span className="font-semibold">{formatRM(r.amountOwed)}</span>
                        </div>
                      </div>
                      {r.carriedForward > 0 && <p className="text-xs text-ink-soft">{formatRM(r.carriedForward)} unpaid was moved to the next bill.</p>}
                      {r.payments?.length > 0 && (
                        <ul className="text-xs text-ink-soft">
                          {r.payments.map((p, i) => (
                            <li key={i} className="num">
                              {formatDate(p.at)} — {formatRM(p.amount)}
                              {p.note ? ` (${p.note})` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      <ReceivableActions receivable={r} transaction={t} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {t.category === "House Bill" && !t.shares && (
            <p className="text-sm text-ink-soft">This bill isn&rsquo;t split yet. Edit it and turn on &ldquo;Split with housemates&rdquo; to charge each housemate their share.</p>
          )}
        </div>
      </Dialog>
      <TransactionForm open={editing} existing={t} onClose={() => setEditing(false)} />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
