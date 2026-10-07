"use client";

import { useMemo, useState } from "react";
import { BillDetail } from "@/components/BillDetail";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { errorText, useToast } from "@/components/providers/ToastProvider";
import { TransactionForm } from "@/components/TransactionForm";
import { Button, cx, Dialog, EmptyState, Field, Input, Meter, Money, Notice, PageHeader, Panel } from "@/components/ui";
import { saveSettings } from "@/lib/db";
import { adminCost, monthSummary } from "@/lib/selectors";
import { formatDate, formatMonth, monthKey, shiftMonths, mytDate } from "@/lib/shared/dates";
import { formatRM, round2 } from "@/lib/shared/money";
import { PERSONAL_EXPENSE_SUBCATEGORIES } from "@/lib/shared/types";

function keyToDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return mytDate(y, m, 15);
}

export default function PersonalPage() {
  const { transactions, settings } = useData();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [adding, setAdding] = useState<"Personal Expense" | "Income" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingCaps, setEditingCaps] = useState(false);

  const summary = useMemo(() => monthSummary(transactions, month, settings.adminName), [transactions, month, settings.adminName]);
  const entries = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === month && t.category !== "House Bill").sort((a, b) => b.date.getTime() - a.date.getTime()),
    [transactions, month],
  );
  const houseBills = useMemo(() => transactions.filter((t) => monthKey(t.date) === month && t.category === "House Bill"), [transactions, month]);
  const bySub = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of entries) if (t.category === "Personal Expense") map[t.subCategory] = round2((map[t.subCategory] ?? 0) + t.totalAmount);
    return map;
  }, [entries]);

  const caps = settings.personalBudgetCaps ?? {};
  const overall = settings.monthlyPersonalBudget ?? 0;
  const capped = PERSONAL_EXPENSE_SUBCATEGORIES.filter((s) => (caps[s] ?? 0) > 0 || (bySub[s] ?? 0) > 0);
  const isCurrent = month === monthKey(new Date());

  return (
    <>
      <PageHeader
        title="Personal budget"
        description="Your own income and spending, kept separate from what housemates owe."
        actions={
          <>
            <Button onClick={() => setAdding("Income")}>Add income</Button>
            <Button variant="primary" onClick={() => setAdding("Personal Expense")}>
              <Icon name="plus" className="h-4 w-4" /> Add expense
            </Button>
          </>
        }
      />

      <div className="mb-6 flex items-center gap-2">
        <Button size="sm" aria-label="Previous month" onClick={() => setMonth(monthKey(shiftMonths(keyToDate(month), -1)))}>
          ‹
        </Button>
        <p className="min-w-40 text-center text-lg font-semibold">{formatMonth(month)}</p>
        <Button size="sm" aria-label="Next month" onClick={() => setMonth(monthKey(shiftMonths(keyToDate(month), 1)))}>
          ›
        </Button>
        {!isCurrent && (
          <Button size="sm" variant="ghost" onClick={() => setMonth(monthKey(new Date()))}>
            This month
          </Button>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Figure label="Income" value={summary.income} tone="good" />
        <Figure label="Personal spending" value={summary.personal} />
        <Figure label="Your share of house bills" value={summary.houseShare} />
        <Figure label="Left over" value={summary.net} tone={summary.net < 0 ? "bad" : "good"} emphasis />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Budget caps" action={<Button size="sm" variant="ghost" onClick={() => setEditingCaps(true)}>Edit caps</Button>}>
          {overall > 0 && (
            <div className="mb-5">
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium">All personal spending</span>
                <span className="num">
                  {formatRM(summary.personal)} <span className="text-ink-soft">of {formatRM(overall)}</span>
                </span>
              </div>
              <Meter value={summary.personal} max={overall} label="Overall budget used" />
            </div>
          )}
          {capped.length === 0 && overall === 0 ? (
            <p className="text-ink-soft">Set a monthly cap overall or per category (food, transport…) to see how close you are.</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {capped.map((s) => {
                const spent = bySub[s] ?? 0;
                const cap = caps[s] ?? 0;
                return (
                  <li key={s}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{s}</span>
                      <span className={cx("num", cap > 0 && spent > cap && "font-semibold text-pending")}>
                        {formatRM(spent)}
                        {cap > 0 && <span className="font-normal text-ink-soft"> of {formatRM(cap)}</span>}
                      </span>
                    </div>
                    {cap > 0 ? <Meter value={spent} max={cap} label={`${s} budget used`} /> : <div className="h-2 rounded-full bg-paper" />}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Entries" padded={false}>
          {entries.length === 0 && houseBills.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nothing this month">Add expenses as you go, or import a bank statement from Import &amp; export.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-paper/50">
                    <div>
                      <p className="font-medium">{t.vendor}</p>
                      <p className="text-sm text-ink-soft">
                        {t.subCategory} · {formatDate(t.date)}
                      </p>
                    </div>
                    <Money value={t.category === "Income" ? t.totalAmount : -t.totalAmount} signed className={cx("font-medium", t.category === "Income" && "text-settled")} />
                  </button>
                </li>
              ))}
              {houseBills.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSelected(t.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-paper/50">
                    <div>
                      <p className="font-medium">{t.vendor}</p>
                      <p className="text-sm text-ink-soft">
                        Your share of {t.subCategory.toLowerCase()} · {formatDate(t.date)}
                      </p>
                    </div>
                    <Money value={-adminCost(t, settings.adminName)} className="font-medium text-ink-soft" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <TransactionForm open={adding !== null} defaultCategory={adding ?? "Personal Expense"} onClose={() => setAdding(null)} />
      <BillDetail transactionId={selected} onClose={() => setSelected(null)} />
      {editingCaps && <CapsDialog onClose={() => setEditingCaps(false)} />}
    </>
  );
}

function Figure({ label, value, tone, emphasis }: { label: string; value: number; tone?: "good" | "bad"; emphasis?: boolean }) {
  return (
    <div className={cx("rounded-[var(--radius-panel)] border px-5 py-4", emphasis ? "border-transparent bg-plum text-white" : "border-line bg-surface")}>
      <p className={cx("text-sm", emphasis ? "text-white/60" : "text-ink-soft")}>{label}</p>
      <p className={cx("num mt-1 text-[1.5rem] font-semibold", !emphasis && tone === "good" && "text-settled", !emphasis && tone === "bad" && "text-pending", emphasis && tone === "bad" && "text-[#ff9c9c]")}>
        {formatRM(value)}
      </p>
    </div>
  );
}

function CapsDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const toast = useToast();
  const [overall, setOverall] = useState(String(settings.monthlyPersonalBudget || ""));
  const [caps, setCaps] = useState<Record<string, string>>(() =>
    Object.fromEntries(PERSONAL_EXPENSE_SUBCATEGORIES.map((s) => [s, settings.personalBudgetCaps?.[s] ? String(settings.personalBudgetCaps[s]) : ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(caps)) {
        const n = Number(v);
        if (n > 0) clean[k] = round2(n);
      }
      await saveSettings({ monthlyPersonalBudget: Math.max(0, round2(Number(overall) || 0)), personalBudgetCaps: clean });
      toast("Budget caps saved");
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
      title="Monthly budget caps"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save caps
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="All personal spending (RM)" hint="Leave blank for no overall cap.">
          {(id) => <Input id={id} type="number" min="0" step="1" value={overall} onChange={(e) => setOverall(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {PERSONAL_EXPENSE_SUBCATEGORIES.map((s) => (
            <Field key={s} label={s}>
              {(id) => <Input id={id} type="number" min="0" step="1" placeholder="No cap" value={caps[s]} onChange={(e) => setCaps({ ...caps, [s]: e.target.value })} />}
            </Field>
          ))}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
