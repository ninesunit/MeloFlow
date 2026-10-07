"use client";

import { useMemo, useRef, useState } from "react";
import { ai } from "@/lib/ai";
import { createTransaction, replaceTransaction, updateTransactionDetails, type TransactionInput } from "@/lib/db";
import { deleteStoredFile, prepareBillFile, saveFile } from "@/lib/files";
import { fromDateInput, mytParts, toDateInput } from "@/lib/shared/dates";
import { round2 } from "@/lib/shared/money";
import { planReceivables, splitBill, SplitError } from "@/lib/shared/split";
import { configFromDraft, defaultSplitDraft, describeSplit, draftFromConfig, type SplitDraft } from "@/lib/shared/split-defaults";
import { CATEGORIES, subCategoriesFor, type Category, type SplitConfig, type Transaction, type UserSettings } from "@/lib/shared/types";
import { Icon } from "./icons";
import { errorText, useToast } from "./providers/ToastProvider";
import { useData } from "./providers/DataProvider";
import { SplitEditor } from "./SplitEditor";
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
  split: SplitDraft;
  /** True once the split was changed by hand, so picking a kind won't overwrite it. */
  splitTouched: boolean;
  receiptFileId: string | null;
}

/** Change the kind of bill, applying that kind's saved default split unless the split was edited. */
function withKind(s: FormState, category: Category, subCategory: string, ctx: { settings: Pick<UserSettings, "defaultSplits">; people: string[]; adminName: string }): FormState {
  const next = { ...s, category, subCategory };
  if (category !== "House Bill") return { ...next, splitEnabled: false };
  if (s.splitTouched) return { ...next, splitEnabled: s.category === "House Bill" ? s.splitEnabled : true };
  return { ...next, splitEnabled: true, split: defaultSplitDraft(ctx.settings, subCategory, ctx.people, ctx.adminName) };
}

function initialState(
  t: Transaction | null | undefined,
  people: string[],
  adminName: string,
  defaultCategory: Category,
  settings: Pick<UserSettings, "defaultSplits">,
): FormState {
  const today = toDateInput(new Date());
  if (!t) {
    const subCategory = defaultCategory === "House Bill" ? "Electric" : subCategoriesFor(defaultCategory)[0];
    return {
      category: defaultCategory,
      subCategory,
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
      split: defaultSplitDraft(settings, subCategory, people, adminName),
      splitTouched: false,
      receiptFileId: null,
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
    // An existing bill keeps its own split; an unsplit one starts from the kind's default.
    split: split ? draftFromConfig(split, people, adminName) : defaultSplitDraft(settings, t.subCategory, people, adminName),
    splitTouched: Boolean(split),
    receiptFileId: t.receiptFileId ?? null,
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
  const [f, setF] = useState<FormState>(() => initialState(existing, people, adminName, defaultCategory, settings));
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

  const kindCtx = { settings, people, adminName };
  const splitConfig: SplitConfig | null = useMemo(
    () => (isHouse && f.splitEnabled ? configFromDraft(f.split, people) : null),
    [isHouse, f.splitEnabled, f.split, people],
  );
  const savedDefault = settings.defaultSplits?.[f.subCategory];
  const usingDefault = !f.splitTouched && !existing?.split;

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
      // Shrink photos in the browser: one copy for the AI to read, a smaller one to keep.
      const prepared = await prepareBillFile(file);
      let keptNote = "";
      if (prepared.forStorage) {
        const id = await saveFile(prepared.forStorage, prepared.name, "receipt");
        if (uploadedThisSession.current) await deleteStoredFile(uploadedThisSession.current);
        uploadedThisSession.current = id;
        setF((s) => ({ ...s, receiptFileId: id }));
      } else {
        keptNote = " This PDF is too large to keep (over 600 KB), so it won't be attached — a photo or screenshot of the bill can be.";
      }
      if (!prepared.forAi) {
        setOcrNote(`This file is over 4 MB, so it can't be read automatically. Fill in the details by hand.${keptNote}`);
        return;
      }
      try {
        const parsed = await ai.parseBill(prepared.forAi, prepared.name);
        setF((s) => {
          const category = parsed.category ?? s.category;
          const subs = subCategoriesFor(category);
          const subCategory = parsed.subCategory && subs.includes(parsed.subCategory) ? parsed.subCategory : category === s.category ? s.subCategory : subs[0];
          const kinded = moneyLocked ? s : withKind(s, category, subCategory, kindCtx);
          return {
            ...kinded,
            vendor: parsed.vendor ?? s.vendor,
            amount: parsed.totalAmount != null ? String(parsed.totalAmount) : s.amount,
            date: parsed.billDate ?? s.date,
            dueDate: parsed.dueDate ?? s.dueDate,
            units: parsed.consumptionUnits != null ? String(parsed.consumptionUnits) : s.units,
            periodStart: parsed.billingPeriodStart ?? s.periodStart,
            periodEnd: parsed.billingPeriodEnd ?? s.periodEnd,
          };
        });
        setOcrNote(
          (parsed.notes ? `Filled in from the bill. Note: ${parsed.notes}` : "Filled in from the bill — check the numbers before saving.") + keptNote,
        );
      } catch (e) {
        setOcrNote(`${prepared.forStorage ? "The bill is attached, but it" : "It"} couldn't be read automatically: ${errorText(e)} Fill in the details by hand.${keptNote}`);
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
      receiptFileId: f.receiptFileId,
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
              receiptFileId: input.receiptFileId,
              dueDate: input.dueDate,
              isRecurring: input.isRecurring,
              frequency: input.frequency,
              recurrenceDay: input.recurrenceDay,
            },
            existing.receivableIds,
          );
        }
        if (existing.receiptFileId && existing.receiptFileId !== input.receiptFileId) await deleteStoredFile(existing.receiptFileId);
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
    if (uploadedThisSession.current) await deleteStoredFile(uploadedThisSession.current);
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
            {f.receiptFileId ? "Replace bill or receipt" : "Upload bill or receipt"}
          </Button>
          <p className="text-sm text-ink-soft">
            {reading ? "Reading the bill…" : f.receiptFileId ? (
              <a href={`/f/${f.receiptFileId}/`} target="_blank" rel="noreferrer" className="text-violet underline">
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
            setF((s) => withKind(s, c, subCategoriesFor(c)[0], kindCtx));
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            {(id) => (
              <Select
                id={id}
                value={f.subCategory}
                onChange={(e) => {
                  const sub = e.target.value;
                  setF((s) => (moneyLocked || existing?.split ? { ...s, subCategory: sub } : withKind(s, s.category, sub, kindCtx)));
                }}
              >
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
              {f.splitEnabled && usingDefault && (
                <span className="text-xs text-ink-soft">
                  {savedDefault ? `Your default for ${f.subCategory}: ${describeSplit(savedDefault, people)}` : "Everyone equally — set defaults in Settings"}
                </span>
              )}
            </div>
            {f.splitEnabled && (
              <>
                <SplitEditor
                  draft={f.split}
                  onChange={(split) => setF((s) => ({ ...s, split, splitTouched: true }))}
                  people={people}
                  adminName={adminName}
                  shares={preview?.shares}
                  plans={preview?.plans}
                />
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
