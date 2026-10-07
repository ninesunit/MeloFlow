"use client";

import { useMemo, useState } from "react";
import { BillDetail } from "@/components/BillDetail";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { errorText, useToast } from "@/components/providers/ToastProvider";
import { ReceivableActions } from "@/components/ReceivableActions";
import { Button, cx, Dialog, EmptyState, Field, Input, Money, Notice, PageHeader, Panel, Segmented, StatusBadge } from "@/components/ui";
import { WhatsAppDialog } from "@/components/WhatsAppDialog";
import { adjustBalance } from "@/lib/db";
import { housemateSummaries } from "@/lib/selectors";
import { formatDate } from "@/lib/shared/dates";
import { noticeLinks } from "@/lib/files";
import { buildOutstandingSummary } from "@/lib/shared/message";
import { formatRM, isZero, round2 } from "@/lib/shared/money";

const REASONS: Record<string, string> = {
  "applied-to-bill": "Applied to a new bill",
  overpayment: "Overpaid — kept as credit",
  "carry-forward": "Unpaid remainder carried over",
  "bill-deleted": "Bill deleted — reversed",
  "manual-adjustment": "Manual adjustment",
};

export default function SettlePage() {
  const { housemates, receivables, transactions, balances, balanceEvents, settings } = useData();
  const [selected, setSelected] = useState<string | null>(null);
  const [remind, setRemind] = useState<{ name: string; draft: string } | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const mates = useMemo(() => housemateSummaries(housemates, receivables, transactions, balances), [housemates, receivables, transactions, balances]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

  if (housemates.length === 0) {
    return (
      <>
        <PageHeader title="Settle up" />
        <EmptyState title="No housemates yet">Add your housemates in Settings to start splitting bills.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settle up" description="What each housemate still owes, bill by bill. Record payments as they come in." />

      <div className="grid gap-6 xl:grid-cols-2">
        {mates.map((m) => {
          const settled = receivables
            .filter((r) => r.debtorName === m.name && r.status === "Settled" && txById.has(r.transactionId))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, 8);
          const events = balanceEvents.filter((e) => e.debtorName === m.name).slice(0, 6);
          return (
            <Panel
              key={m.name}
              title={m.name}
              padded={false}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAdjusting(m.name)}>
                    Adjust balance
                  </Button>
                  {(m.outstanding > 0 || m.runningBalance > 0) && (
                    <Button
                      size="sm"
                      variant="whatsapp"
                      onClick={() =>
                        setRemind({
                          name: m.name,
                          draft: buildOutstandingSummary(
                            settings,
                            m.name,
                            m.open.map((o) => ({ label: `${o.transaction.subCategory} (${o.transaction.vendor})`, dueDate: o.transaction.dueDate, outstanding: o.due })),
                            m.runningBalance,
                            noticeLinks(settings),
                          ),
                        })
                      }
                    >
                      <Icon name="chat" className="h-4 w-4" /> Send summary
                    </Button>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-2 border-b border-line">
                <div className="px-5 py-4">
                  <p className="text-sm text-ink-soft">Owes on open bills</p>
                  <p className={cx("num text-[1.6rem] font-semibold", m.outstanding > 0 ? "text-pending" : "text-ink")}>{formatRM(m.outstanding)}</p>
                </div>
                <div className="border-l border-line px-5 py-4">
                  <p className="text-sm text-ink-soft">Running balance</p>
                  <p className={cx("num text-[1.6rem] font-semibold", m.runningBalance > 0 ? "text-partial" : m.runningBalance < 0 ? "text-settled" : "text-ink")}>
                    {formatRM(m.runningBalance)}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {isZero(m.runningBalance) ? "Nothing carried over" : m.runningBalance > 0 ? "Added to the next bill" : "Credit taken off the next bill"}
                  </p>
                </div>
              </div>

              {m.open.length === 0 ? (
                <p className="px-5 py-5 text-ink-soft">{m.name} is all paid up.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {m.open.map(({ receivable: r, transaction: t, due }) => (
                    <li key={r.id} className="flex flex-col gap-2.5 px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button className="text-left" onClick={() => setSelected(t.id)}>
                          <p className="font-medium hover:underline">
                            {t.subCategory} · {t.vendor}
                          </p>
                          <p className="text-sm text-ink-soft">
                            {t.dueDate ? `Due ${formatDate(t.dueDate)}` : formatDate(t.date)}
                            {r.amountPaid > 0 && ` · paid ${formatRM(r.amountPaid)} of ${formatRM(r.amountOwed)}`}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          <Money value={due} className="font-semibold" />
                          <StatusBadge status={r.status} />
                        </div>
                      </div>
                      <ReceivableActions receivable={r} transaction={t} />
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-line px-5 py-4">
                <Segmented
                  label="History"
                  value={showSettled ? "settled" : "balance"}
                  onChange={(v) => setShowSettled(v === "settled")}
                  options={[
                    { value: "balance", label: "Balance changes" },
                    { value: "settled", label: "Recently settled" },
                  ]}
                />
                {showSettled ? (
                  settled.length ? (
                    <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                      {settled.map((r) => {
                        const t = txById.get(r.transactionId)!;
                        return (
                          <li key={r.id} className="flex justify-between gap-3">
                            <button className="text-left text-ink-soft hover:underline" onClick={() => setSelected(t.id)}>
                              {t.subCategory} · {t.vendor} · {formatDate(t.date)}
                            </button>
                            <span className="num">{formatRM(r.amountPaid)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-ink-soft">No settled bills yet.</p>
                  )
                ) : events.length ? (
                  <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                    {events.map((e) => (
                      <li key={e.id} className="flex justify-between gap-3">
                        <span className="text-ink-soft">
                          {formatDate(e.at)} · {REASONS[e.reason] ?? e.reason}
                          {e.note && e.reason === "manual-adjustment" ? ` (${e.note})` : ""}
                        </span>
                        <span className="num whitespace-nowrap">
                          {e.delta > 0 ? "+" : ""}
                          {formatRM(e.delta)} → {formatRM(e.balanceAfter)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-ink-soft">No balance changes yet.</p>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <BillDetail transactionId={selected} onClose={() => setSelected(null)} />
      {remind && <WhatsAppDialog open onClose={() => setRemind(null)} debtorName={remind.name} draft={remind.draft} />}
      {adjusting && <AdjustDialog name={adjusting} current={balances[adjusting] ?? 0} onClose={() => setAdjusting(null)} />}
    </>
  );
}

function AdjustDialog({ name, current, onClose }: { name: string; current: number; onClose: () => void }) {
  const toast = useToast();
  const [direction, setDirection] = useState<"owes" | "credit">("owes");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const delta = round2(direction === "owes" ? n : -n);

  async function save() {
    if (!(n > 0)) return setError("Enter an amount.");
    if (!note.trim()) return setError("Add a short reason so you remember later.");
    setBusy(true);
    try {
      await adjustBalance(name, delta, note.trim());
      toast("Balance updated");
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Adjust ${name}'s balance`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Update balance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ink-soft">
          Use this for money outside a bill — e.g. {name} paid you cash in advance, or you agreed to forgive a small amount. Current balance:{" "}
          <span className="num font-semibold text-ink">{formatRM(current)}</span>
        </p>
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "owes", label: `${name} owes more` },
            { value: "credit", label: `Give ${name} credit` },
          ]}
        />
        <Field label="Amount (RM)">{(id) => <Input id={id} type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Reason">{(id) => <Input id={id} placeholder="e.g. Paid RM50 cash in advance" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {n > 0 && (
          <p className="text-sm text-ink-soft">
            New balance: <span className="num font-medium text-ink">{formatRM(round2(current + delta))}</span> — applied to {name}&rsquo;s next bill.
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
