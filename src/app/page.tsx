"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BillDetail } from "@/components/BillDetail";
import type { CalendarEntry } from "@/components/BillCalendar";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { TransactionForm } from "@/components/TransactionForm";
import { Button, Checkbox, cx, EmptyState, Money, Notice, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { WhatsAppDialog } from "@/components/WhatsAppDialog";
import { housemateSummaries, INCOME_COLOR, monthSummary, PERSONAL_COLOR, STATUS_COLORS, upcomingDue } from "@/lib/selectors";
import { formatDate, formatMonth, monthKey } from "@/lib/shared/dates";
import { buildOutstandingSummary } from "@/lib/shared/message";
import { formatRM, isZero } from "@/lib/shared/money";
import { upcomingOccurrences } from "@/lib/shared/recurring";
import { detectAnomalies, unitLabel } from "@/lib/shared/utilities";

const BillCalendar = dynamic(() => import("@/components/BillCalendar"), {
  ssr: false,
  loading: () => <div className="h-[560px] animate-pulse rounded-[var(--radius-control)] bg-paper" />,
});

export default function Dashboard() {
  const { transactions, receivables, balances, housemates, settings } = useData();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPersonal, setShowPersonal] = useState(false);
  const [remind, setRemind] = useState<{ name: string; draft: string } | null>(null);

  const now = useMemo(() => new Date(), []);
  const thisMonth = monthKey(now);
  const summary = useMemo(() => monthSummary(transactions, thisMonth, settings.adminName), [transactions, thisMonth, settings.adminName]);
  const mates = useMemo(() => housemateSummaries(housemates, receivables, transactions, balances), [housemates, receivables, transactions, balances]);
  const due = useMemo(() => upcomingDue(transactions, now), [transactions, now]);
  const anomalies = useMemo(() => detectAnomalies(transactions, settings.monthlyUtilityCaps).filter((a) => a.isSpike || a.overCap), [transactions, settings.monthlyUtilityCaps]);
  const totalOwedToAdmin = mates.reduce((s, m) => s + m.outstanding + Math.max(0, m.runningBalance), 0);

  const entries = useMemo<CalendarEntry[]>(() => {
    const list: CalendarEntry[] = [];
    for (const t of transactions) {
      if (t.category !== "House Bill" && !showPersonal) continue;
      list.push({
        id: t.id,
        title: `${t.subCategory} · ${t.vendor}`,
        date: t.category === "House Bill" ? t.dueDate ?? t.date : t.date,
        amount: t.totalAmount,
        color: t.category === "House Bill" ? STATUS_COLORS[t.status] : t.category === "Income" ? INCOME_COLOR : PERSONAL_COLOR,
      });
    }
    // Show the next few months of recurring bills that haven't been generated yet.
    const ids = new Set(transactions.map((t) => t.id));
    for (const t of transactions.filter((x) => x.isRecurring && (x.category === "House Bill" || showPersonal))) {
      for (const occ of upcomingOccurrences(t, now, 3)) {
        if (ids.has(occ.id)) continue;
        list.push({ id: occ.id, title: `${t.subCategory} (upcoming)`, date: occ.dueDate ?? occ.date, amount: t.totalAmount, color: "#5b3fa8", projected: true });
      }
    }
    return list;
  }, [transactions, showPersonal, now]);

  const hasAnything = transactions.length > 0;

  return (
    <>
      <PageHeader
        title={formatMonth(thisMonth)}
        description="Who owes what, what's due, and how your own money is doing this month."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> Add entry
          </Button>
        }
      />

      {/* House ledger: the one bold element on the page */}
      <section aria-label="Housemate balances" className="mb-6 overflow-hidden rounded-[var(--radius-panel)] bg-plum text-white">
        <div className="grid divide-white/12 sm:grid-cols-[1.2fr_repeat(var(--n),1fr)] sm:divide-x" style={{ ["--n" as string]: Math.max(1, mates.length) }}>
          <div className="px-6 py-5">
            <p className="text-sm text-white/60">Owed to {settings.adminName}</p>
            <p className="num mt-1 text-[2.6rem] leading-none font-semibold tracking-[-0.02em]">{formatRM(totalOwedToAdmin)}</p>
            <p className="mt-2 text-sm text-white/60">across {receivables.filter((r) => r.status !== "Settled").length} unpaid shares</p>
          </div>
          {mates.map((m) => (
            <div key={m.name} className="flex flex-col justify-between gap-3 border-t border-white/12 px-6 py-5 sm:border-t-0">
              <div>
                <p className="text-sm text-white/60">{m.name}</p>
                <p className="num mt-1 text-[1.7rem] leading-none font-semibold">{formatRM(m.outstanding)}</p>
                <p className="num mt-2 text-xs text-white/55">
                  {isZero(m.runningBalance)
                    ? m.open.length
                      ? `${m.open.length} bill${m.open.length > 1 ? "s" : ""} open`
                      : "All settled"
                    : m.runningBalance > 0
                      ? `+${formatRM(m.runningBalance)} carried to next bill`
                      : `${formatRM(-m.runningBalance)} credit for next bill`}
                </p>
              </div>
              {(m.outstanding > 0 || m.runningBalance > 0) && (
                <button
                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/18"
                  onClick={() =>
                    setRemind({
                      name: m.name,
                      draft: buildOutstandingSummary(
                        settings,
                        m.name,
                        m.open.map((o) => ({ label: `${o.transaction.subCategory} (${o.transaction.vendor})`, dueDate: o.transaction.dueDate, outstanding: o.due })),
                        m.runningBalance,
                      ),
                    })
                  }
                >
                  <Icon name="chat" className="h-4 w-4" /> Remind
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {anomalies.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {anomalies.map((a) => (
            <Notice key={a.kind} tone={a.isSpike ? "warn" : "info"}>
              <span className="font-semibold">{a.kind === "Electric" ? "Electricity" : "Water"}</span>
              {a.isSpike && (
                <>
                  {" "}
                  bill of {formatRM(a.bill.totalAmount)} is {Math.round(a.costChange * 100)}% above the 3-month average ({formatRM(a.avgCost)})
                  {a.unitsChange !== null && `, usage ${a.unitsChange >= 0 ? "up" : "down"} ${Math.abs(Math.round(a.unitsChange * 100))}% (${a.bill.consumptionUnits} ${unitLabel(a.kind)})`}.
                </>
              )}
              {a.overCap && ` It's over your ${formatRM(a.cap)} monthly cap.`}{" "}
              <Link href="/utilities/" className="text-violet underline">
                See why
              </Link>
            </Notice>
          ))}
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <Panel title="Your cash flow this month">
          <dl className="flex flex-col gap-2.5">
            <Row label="Income" value={summary.income} />
            <Row label="Personal spending" value={-summary.personal} />
            <Row label={`Your share of house bills (of ${formatRM(summary.houseTotal)})`} value={-summary.houseShare} />
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-semibold">Net</dt>
              <dd className={cx("num text-xl font-semibold", summary.net < 0 ? "text-pending" : "text-settled")}>{formatRM(summary.net)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-faint">Money housemates owe you isn&rsquo;t counted here — it&rsquo;s tracked in Settle up.</p>
        </Panel>

        <Panel title="Due in the next two weeks" action={<Link href="/bills/" className="text-sm text-violet">All bills</Link>} padded={false}>
          {due.length === 0 ? (
            <p className="px-5 py-6 text-ink-soft">Nothing due. Bills you add with a due date show up here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {due.slice(0, 7).map((d) => (
                <li key={d.id}>
                  <button
                    disabled={d.projected}
                    onClick={() => setSelected(d.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left enabled:hover:bg-paper/60"
                  >
                    <div>
                      <p className="font-medium">{d.label}</p>
                      <p className={cx("text-sm", d.overdue ? "text-pending" : "text-ink-soft")}>
                        {d.overdue ? "Overdue · " : ""}
                        {d.projected ? "Created on " : "Due "}
                        {formatDate(d.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money value={d.amount} className="font-medium" />
                      {!d.projected && <StatusBadge status={d.status} />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Bill calendar"
        action={<Checkbox label={<span className="text-sm">Show personal entries</span>} checked={showPersonal} onChange={setShowPersonal} />}
      >
        {hasAnything ? (
          <>
            <BillCalendar entries={entries} onSelect={setSelected} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
              <Legend color={STATUS_COLORS.Pending} label="Pending" />
              <Legend color={STATUS_COLORS.Partial} label="Partly paid" />
              <Legend color={STATUS_COLORS.Settled} label="Settled" />
              <Legend color="#5b3fa8" label="Upcoming repeat" outline />
              {showPersonal && <Legend color={PERSONAL_COLOR} label="Personal" />}
            </div>
          </>
        ) : (
          <EmptyState
            title="No bills yet"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add your first bill
              </Button>
            }
          >
            Add this month&rsquo;s rent, TNB or Air Selangor bill — upload a photo and the form fills itself in. Set rent and Wi-Fi to repeat and they&rsquo;ll appear every month.
          </EmptyState>
        )}
      </Panel>

      <TransactionForm open={adding} onClose={() => setAdding(false)} />
      <BillDetail transactionId={selected} onClose={() => setSelected(null)} />
      {remind && <WhatsAppDialog open onClose={() => setRemind(null)} debtorName={remind.name} draft={remind.draft} />}
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num whitespace-nowrap">{formatRM(value)}</dd>
    </div>
  );
}

function Legend({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={outline ? { border: `1.5px solid ${color}` } : { background: color }} />
      {label}
    </span>
  );
}
