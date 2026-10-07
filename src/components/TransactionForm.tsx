"use client";

import { useMemo, useRef, useState } from "react";
import { ai } from "@/lib/ai";
import { createTransaction, deleteFile, replaceTransaction, updateTransactionDetails, uploadFile, type TransactionInput } from "@/lib/db";
import { fromDateInput, mytParts, toDateInput } from "@/lib/shared/dates";
import { formatRM, round2 } from "@/lib/shared/money";
import { planReceivables, splitBill, SplitError } from "@/lib/shared/split";
import { CATEGORIES, subCategoriesFor, type Category, type SplitConfig, type SplitMode, type Transaction } from "@/lib/shared/types";
import { Icon } from "./icons";
import { errorText, useToast } from "./providers/ToastProvider";
import { useData } from "./providers/DataProvider";
import { Button, Checkbox, cx, Dialog, Field, Input, Notice, Segmented, Select, Spinner, Textarea } from "./ui";

interface FormState {
  category: Category;
  subCategory: string;
  vendor: string;
  description: string;
  amount: string;
  date: string;
  dueDate: string;
  units: string;
  periodStart: string;
  periodEnd: string;
  isRecurring: boolean;
  frequency: "Monthly" | "Yearly";
  recurrenceDay: string;
  splitEnabled: boolean;
  mode: SplitMode;
  participants: string[];
  ratios: Record<string, string>;
  fixed: Record<string, string>;
  receiptUrl: string | null;
  receiptPath: string | null;
}

function initialState(t: Transaction | null | undefined, people: string[], adminName: string, defaultCategory: Category): FormState {
  const today = toDateInput(new Date());
  if (!t) {
    const share = people.length ? round2(100 / people.length) : 0;
    return {
      category: defaultCategory,
      subCategory: defaultCategory === "House Bill" ? "Electric" : subCategoriesFor(defaultCategory)[0],
      vendor: "",
      description: "",
      amount: "",
      date: today,
      dueDate: "",
      units: "",
      periodStart: "",
      periodEnd: "",
      isRecurring: false,
      frequency: "Monthly",
      recurrenceDay: String(Math.min(28, mytParts(new Date()).day)),
      splitEnabled: defaultCategory === "House Bill",
      mode: "equal",
      participants: [...people],
      ratios: Object.fromEntries(people.map((p) => [p, String(share)])),
      fixed: Object.fromEntries(people.filter((p) => p !== adminName).map((p) => [p, ""])),
      receiptUrl: null,
      receiptPath: null,
    };
  }
  const split = t.split;
  return {
    category: t.category,
    subCategory: t.subCategory,
    vendor: t.vendor,
    description: t.description ?? "",
    amount: String(t.totalAmount),
    date: toDateInput(t.date),
    dueDate: toDateInput(t.dueDate),
    units: t.consumptionUnits != null ? String(t.consumptionUnits) : "",
    periodStart: toDateInput(t.billingPeriodStart),
    periodEnd: toDateInput(t.billingPeriodEnd),
    isRecurring: t.isRecurring,
    frequency: t.frequency ?? "Monthly",
    recurrenceDay: String(t.recurrenceDay ?? Math.min(28, mytParts(t.date).day)),
    splitEnabled: Boolean(split),
    mode: split?.mode ?? "equal",
    participants: split?.participants ?? [...people],
    ratios: Object.fromEntries(people.map((p) => [p, String(split?.ratios?.[p] ?? round2(100 / people.length))])),
    fixed: Object.fromEntries(people.filter((p) => p !== adminName).map((p) => [p, split?.fixedAmounts?.[p] != null ? String(split.fixedAmounts[p]) : ""])),
    receiptUrl: t.receiptUrl ?? null,
    receiptPath: t.receiptPath ?? null,
  };
}

function toNumber(s: string): number {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export function TransactionForm({
  open,
  onClose,
  existing,
  defaultCategory = "House Bill",
}: {
  open: boolean;
  onClose: () => void;
  existing?: Transaction | null;
  defaultCategory?: Category;
}) {
  if (!open) return null;
  return <TransactionFormInner onClose={onClose} existing={existing ?? null} defaultCategory={defaultCategory} />;
}

function TransactionFormInner({ onClose, existing, defaultCategory }: { onClose: () => void; existing: Transaction | null; defaultCategory: Category }) {
  const { people, settings, balances, receivablesByTx } = useData();
  const toast = useToast();
  const adminName = settings.adminName;
  const [f, setF] = useState<FormState>(() => initialState(existing, people, adminName, defaultCategory));
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadedThisSession = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const existingReceivables = useMemo(() => (existing ? receivablesByTx.get(existing.id) ?? [] : []), [existing, receivablesByTx]);
  const moneyLocked = existingReceivables.some((r) => r.amountPaid > 0 || r.carriedForward > 0);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));
  const isHouse = f.category === "House Bill";
  const isUtility = isHouse && (f.subCategory === "Electric" || f.subCategory === "Water");
  const amount = toNumber(f.amount);

  const splitConfig: SplitConfig | null = useMemo(() => {
    if (!isHouse || !f.splitEnabled) return null;
    return {
      mode: f.mode,
      participants: people.filter((p) => f.participants.includes(p)),
      ...(f.mode === "ratio" ? { ratios: Object.fromEntries(people.filter((p) => f.participants.includes(p)).map((p) => [p, toNumber(f.ratios[p] ?? "0") || 0])) } : {}),
      ...(f.mode === "fixed" ? { fixedAmounts: Object.fromEntries(Object.entries(f.fixed).filter(([p]) => f.participants.includes(p)).map(([p, v]) => [p, toNumber(v) || 0])) } : {}),
    };
  }, [isHouse, f.splitEnabled, f.mode, f.participants, f.ratios, f.fixed, people]);

  // Live preview of the split, including running balances.
  const preview = useMemo(() => {
    if (!splitConfig || !(amount > 0)) return null;
    try {
      const shares = splitBill(amount, splitConfig, adminName);
      // When re-splitting an existing bill, its own carry-in will be reversed first.
      const effective = { ...balances };
      for (const r of existingReceivables) effective[r.debtorName] = round2((effective[r.debtorName] ?? 0) + r.carryIn);
      return { shares, plans: planReceivables(shares, adminName, effective), error: null as string | null };
    } catch (e) {
      return { shares: null, plans: [], error: e instanceof SplitError ? e.message : String(e) };
    }
  }, [splitConfig, amount, adminName, balances, existingReceivables]);

  async function onFile(file: File) {
    setError(null);
    setOcrNote(null);
    setReading(true);
    try {
      const { url, path } = await uploadFile("receipts", file);
      if (uploadedThisSession.current) await deleteFile(uploadedThisSession.current);
      uploadedThisSession.current = path;
      setF((s) => ({ ...s, receiptUrl: url, receiptPath: path }));
      try {
        const parsed = await ai.parseBill({ storagePath: path, mimeType: file.type || "application/pdf" });
        setF((s) => {
          const category = parsed.category ?? s.category;
          const subs = subCategoriesFor(category);
          return {
            ...s,
            category,
            subCategory: parsed.subCategory && subs.includes(parsed.subCategory) ? parsed.subCategory : s.subCategory,
            vendor: parsed.vendor ?? s.vendor,
            amount: parsed.totalAmount != null ? String(parsed.totalAmount) : s.amount,
            date: parsed.billDate ?? s.date,
            dueDate: parsed.dueDate ?? s.dueDate,
            units: parsed.consumptionUnits != null ? String(parsed.consumptionUnits) : s.units,
            periodStart: parsed.billingPeriodStart ?? s.periodStart,
            periodEnd: parsed.billingPeriodEnd ?? s.periodEnd,
            splitEnabled: category === "House Bill" ? s.splitEnabled : false,
          };
        });
        setOcrNote(parsed.notes ? `Filled in from the bill. Note: ${parsed.notes}` : "Filled in from the bill — check the numbers before saving.");
      } catch (e) {
        setOcrNote(`The bill is attached, but it couldn't be read automatically: ${errorText(e)} Fill in the details by hand.`);
      }
    } catch (e) {
      setError(`Upload failed: ${errorText(e)}`);
    } finally {
      setReading(false);
    }
  }

  function validate(): string | null {
    if (!f.vendor.trim()) return "Enter who the bill or payment is with.";
    if (!(amount > 0)) return "Enter an amount greater than zero.";
    if (!fromDateInput(f.date)) return "Pick a date.";
    if (f.isRecurring) {
      const day = Number(f.recurrenceDay);
      if (!(day >= 1 && day <= 28)) return "Recurring day must be between 1 and 28.";
    }
    if (splitConfig) {
      if (splitConfig.participants.length === 0) return "Choose who shares this bill.";
      if (preview?.error) return preview.error;
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const units = f.units.trim() === "" ? null : toNumber(f.units);
    const input: TransactionInput = {
      date: fromDateInput(f.date)!,
      category: f.category,
      subCategory: f.subCategory,
      vendor: f.vendor.trim(),
      description: f.description.trim(),
      totalAmount: round2(amount),
      consumptionUnits: isUtility && units !== null && Number.isFinite(units) ? units : null,
      billingPeriodStart: fromDateInput(f.periodStart),
      billingPeriodEnd: fromDateInput(f.periodEnd),
      receiptUrl: f.receiptUrl,
      receiptPath: f.receiptPath,
      dueDate: fromDateInput(f.dueDate),
      isRecurring: f.isRecurring,
      frequency: f.isRecurring ? f.frequency : null,
      recurrenceDay: f.isRecurring ? Number(f.recurrenceDay) : null,
      recurringSourceId: existing?.recurringSourceId ?? null,
      split: splitConfig,
      source: existing?.source ?? (uploadedThisSession.current ? "ocr" : "manual"),
      importHash: existing?.importHash ?? null,
    };
    try {
      if (!existing) {
        await createTransaction(input, adminName);
        toast("Saved");
      } else {
        const moneyChanged =
          existing.category !== input.category ||
          round2(existing.totalAmount) !== input.totalAmount ||
          JSON.stringify(existing.split ?? null) !== JSON.stringify(input.split ?? null);
        if (moneyChanged) {
          await replaceTransaction(existing, input, adminName);
        } else {
          await updateTransactionDetails(
            existing.id,
            {
              date: input.date,
              vendor: input.vendor,
              description: input.description,
              subCategory: input.subCategory,
              consumptionUnits: input.consumptionUnits,
              billingPeriodStart: input.billingPeriodStart,
              billingPeriodEnd: input.billingPeriodEnd,
              receiptUrl: input.receiptUrl,
              receiptPath: input.receiptPath,
              dueDate: input.dueDate,
              isRecurring: input.isRecurring,
              frequency: input.frequency,
              recurrenceDay: input.recurrenceDay,
            },
            existing.receivableIds,
          );
        }
        if (existing.receiptPath && existing.receiptPath !== input.receiptPath) await deleteFile(existing.receiptPath);
        toast("Changes saved");
      }
      uploadedThisSession.current = null;
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    // Don't leave an orphaned upload behind.
    if (uploadedThisSession.current) await deleteFile(uploadedThisSession.current);
    onClose();
  }

  const subs = subCategoriesFor(f.category);
  const unit = f.subCategory === "Electric" ? "kWh" : "m³";

  return (
    <Dialog
      open
      wide
      onClose={cancel}
      title={existing ? "Edit entry" : "Add entry"}
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button variant="primary" onClick={save} busy={saving} disabled={reading}>
            {existing ? "Save changes" : "Save entry"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Upload */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-line bg-paper/60 px-4 py-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={reading}>
            {reading ? <Spinner /> : <Icon name="upload" className="h-4 w-4" />}
            {f.receiptUrl ? "Replace bill or receipt" : "Upload bill or receipt"}
          </Button>
          <p className="text-sm text-ink-soft">
            {reading ? "Reading the bill…" : f.receiptUrl ? (
              <a href={f.receiptUrl} target="_blank" rel="noreferrer" className="text-violet underline">
                View attached file
              </a>
            ) : (
              "A photo or PDF of a TNB, Air Selangor or other bill fills in the form for you."
            )}
          </p>
        </div>
        {ocrNote && <Notice tone="info">{ocrNote}</Notice>}
        {moneyLocked && (
          <Notice tone="warn">A housemate has already paid towards this bill, so its type, amount and split are locked. Other details can still be edited.</Notice>
        )}

        <Segmented
          label="Type"
          value={f.category}
          options={CATEGORIES.map((c) => ({ value: c, label: c === "House Bill" ? "Shared house bill" : c === "Personal Expense" ? "Personal expense" : "Income" }))}
          onChange={(c) => {
            if (moneyLocked) return;
            setF((s) => ({ ...s, category: c, subCategory: subCategoriesFor(c)[0], splitEnabled: c === "House Bill" }));
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={f.subCategory} onChange={(e) => set("subCategory", e.target.value)}>
                {subs.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={f.category === "Income" ? "From" : "Paid to"}>
            {(id) => <Input id={id} value={f.vendor} placeholder={isHouse ? "e.g. TNB" : f.category === "Income" ? "e.g. Part-time job" : "e.g. Lotus's"} onChange={(e) => set("vendor", e.target.value)} />}
          </Field>
          <Field label="Amount (RM)">
            {(id) => <Input id={id} inputMode="decimal" type="number" step="0.01" min="0" value={f.amount} disabled={moneyLocked} onChange={(e) => set("amount", e.target.value)} />}
          </Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
          {f.category !== "Income" && (
            <Field label="Due date" hint="Shown on the calendar and in WhatsApp reminders.">
              {(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}
            </Field>
          )}
          {isUtility && (
            <Field label={`Usage (${unit})`} hint="Used for spike alerts and forecasts.">
              {(id) => <Input id={id} type="number" inputMode="decimal" step="0.01" min="0" value={f.units} onChange={(e) => set("units", e.target.value)} />}
            </Field>
          )}
          {isUtility && (
            <>
              <Field label="Billing period from">{(id) => <Input id={id} type="date" value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} />}</Field>
              <Field label="Billing period to">{(id) => <Input id={id} type="date" value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} />}</Field>
            </>
          )}
        </div>
        <Field label="Note (optional)">{(id) => <Textarea id={id} rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field>

        {/* Recurring */}
        {!existing?.recurringSourceId && (
          <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
            <Checkbox label="Repeat this automatically" checked={f.isRecurring} onChange={(v) => set("isRecurring", v)} />
            {f.isRecurring && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How often">
                  {(id) => (
                    <Select id={id} value={f.frequency} onChange={(e) => set("frequency", e.target.value as "Monthly" | "Yearly")}>
                      <option value="Monthly">Every month</option>
                      <option value="Yearly">Every year</option>
                    </Select>
                  )}
                </Field>
                <Field label="On day of the month" hint="A pending copy is created on this day, from next period onwards.">
                  {(id) => <Input id={id} type="number" min={1} max={28} value={f.recurrenceDay} onChange={(e) => set("recurrenceDay", e.target.value)} />}
                </Field>
              </div>
            )}
          </div>
        )}

        {/* Split */}
        {isHouse && (
          <div className={cx("flex flex-col gap-4 rounded-[var(--radius-control)] border border-line px-4 py-4", moneyLocked && "pointer-events-none opacity-60")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Checkbox label="Split with housemates" checked={f.splitEnabled} onChange={(v) => set("splitEnabled", v)} />
              {f.splitEnabled && (
                <Segmented
                  label="Split method"
                  value={f.mode}
                  options={[
                    { value: "equal", label: "Equally" },
                    { value: "ratio", label: "By %" },
                    { value: "fixed", label: "Fixed RM" },
                  ]}
                  onChange={(m) => set("mode", m)}
                />
              )}
            </div>
            {f.splitEnabled && (
              <>
                <div className="flex flex-col divide-y divide-line">
                  {people.map((p) => {
                    const included = f.participants.includes(p);
                    const plan = preview?.plans.find((x) => x.debtorName === p);
                    const share = preview?.shares?.[p];
                    return (
                      <div key={p} className="flex flex-wrap items-center gap-3 py-2.5">
                        <div className="w-32">
                          <Checkbox
                            label={<span className="font-medium">{p}</span>}
                            checked={included}
                            onChange={(v) => set("participants", v ? [...f.participants, p] : f.participants.filter((x) => x !== p))}
                          />
                        </div>
                        {included && f.mode === "ratio" && (
                          <div className="flex w-28 items-center gap-1">
                            <Input aria-label={`${p} percentage`} type="number" step="0.01" min="0" value={f.ratios[p] ?? ""} onChange={(e) => set("ratios", { ...f.ratios, [p]: e.target.value })} />
                            <span className="text-ink-soft">%</span>
                          </div>
                        )}
                        {included && f.mode === "fixed" && p !== adminName && (
                          <div className="flex w-32 items-center gap-1">
                            <span className="text-ink-soft">RM</span>
                            <Input aria-label={`${p} fixed amount`} type="number" step="0.01" min="0" value={f.fixed[p] ?? ""} onChange={(e) => set("fixed", { ...f.fixed, [p]: e.target.value })} />
                          </div>
                        )}
                        {included && f.mode === "fixed" && p === adminName && <span className="w-32 text-sm text-ink-soft">pays the rest</span>}
                        <div className="ml-auto text-right">
                          {included && share !== undefined && <p className="num font-medium">{formatRM(share)}</p>}
                          {plan && Math.abs(plan.carryIn) >= 0.005 && (
                            <p className="num text-xs text-ink-soft">
                              {plan.carryIn > 0 ? `+${formatRM(plan.carryIn)} carried over` : `${formatRM(plan.carryIn)} credit used`} → owes {formatRM(plan.amountOwed)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {preview?.error && <p className="text-sm text-pending">{preview.error}</p>}
                <p className="text-xs text-ink-faint">
                  Unpaid amounts and overpayments from earlier bills are added to or taken off each housemate&rsquo;s share automatically.
                </p>
              </>
            )}
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
