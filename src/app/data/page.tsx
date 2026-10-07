"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { errorText, useToast } from "@/components/providers/ToastProvider";
import { Button, Checkbox, cx, Field, Notice, PageHeader, Panel, Segmented, Select } from "@/components/ui";
import { ai } from "@/lib/ai";
import { importTransactions, type TransactionInput } from "@/lib/db";
import { exportWorkbook, guessColumn, guessHeaderRow, readWorkbook, type SheetData } from "@/lib/excel";
import { formatDate } from "@/lib/shared/dates";
import { guessCategory, importHash, parseAmount, parseStatementDate, type DateOrder } from "@/lib/shared/importing";
import { formatRM, round2 } from "@/lib/shared/money";
import { CATEGORIES, subCategoriesFor, type Category } from "@/lib/shared/types";

interface Row {
  key: number;
  include: boolean;
  date: Date;
  description: string;
  amount: number; // + in, − out
  category: Category;
  subCategory: string;
  fromHousemate: boolean;
}

export default function DataPage() {
  const data = useData();
  const toast = useToast();

  function doExport() {
    try {
      exportWorkbook({
        transactions: data.transactions,
        receivables: data.receivables,
        balances: data.balances,
        balanceEvents: data.balanceEvents,
        housemates: data.housemates,
        adminName: data.settings.adminName,
      });
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <>
      <PageHeader title="Import & export" description="Bring in bank statements, or download everything as one Excel workbook." />
      <div className="flex flex-col gap-6">
        <Panel title="Download everything">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[60ch] text-ink-soft">
              One Excel file with four sheets: Personal Finances, House Bills, Receivables Ledger and Running Balances (with the full history of carry-overs).
            </p>
            <Button variant="primary" onClick={doExport}>
              <Icon name="download" className="h-4 w-4" /> Download workbook
            </Button>
          </div>
        </Panel>
        <ImportPanel />
      </div>
    </>
  );
}

function ImportPanel() {
  const toast = useToast();
  const { housemates } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [cols, setCols] = useState({ date: -1, desc: -1, amount: -1, debit: -1, credit: -1 });
  const [amountMode, setAmountMode] = useState<"single" | "split">("split");
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [overrides, setOverrides] = useState<Record<number, Partial<Row>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => sheets[sheetIdx]?.rows ?? [], [sheets, sheetIdx]);
  const headers = (rows[headerRow] ?? []).map((h, i) => String(h || `Column ${i + 1}`));

  function setup(sheetList: SheetData[], idx: number) {
    const r = sheetList[idx]?.rows ?? [];
    const hr = guessHeaderRow(r);
    const h = (r[hr] ?? []).map((x) => String(x ?? ""));
    const debit = guessColumn(h, [/debit|withdraw|keluar|money out/]);
    const credit = guessColumn(h, [/credit|deposit|masuk|money in/]);
    setSheetIdx(idx);
    setHeaderRow(hr);
    setCols({
      date: guessColumn(h, [/^date$|transaction date|posting date|tarikh|date/]),
      desc: guessColumn(h, [/desc|details|particular|keterangan|transaction|reference|narrative/]),
      amount: guessColumn(h, [/^amount|amaun|amount/]),
      debit,
      credit,
    });
    setAmountMode(debit >= 0 || credit >= 0 ? "split" : "single");
    setOverrides({});
  }

  async function onFile(file: File) {
    setError(null);
    setBusy("read");
    try {
      const list = await readWorkbook(file);
      if (!list.length || list.every((s) => s.rows.length === 0)) throw new Error("That file has no rows.");
      setFileName(file.name);
      setSheets(list);
      setup(list, Math.max(0, list.findIndex((s) => s.rows.length > 0)));
    } catch (e) {
      setError(`Couldn't read that file: ${errorText(e)} Export the statement from your bank as Excel (.xlsx) or CSV.`);
    } finally {
      setBusy(null);
    }
  }

  const parsed: Row[] = useMemo(() => {
    if (cols.date < 0 || cols.desc < 0) return [];
    const out: Row[] = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseStatementDate(r[cols.date], dateOrder);
      if (!date) continue;
      let amount: number | null = null;
      if (amountMode === "single") {
        amount = cols.amount >= 0 ? parseAmount(r[cols.amount]) : null;
      } else {
        const out_ = cols.debit >= 0 ? parseAmount(r[cols.debit]) : null;
        const in_ = cols.credit >= 0 ? parseAmount(r[cols.credit]) : null;
        if (out_ && Math.abs(out_) > 0) amount = -Math.abs(out_);
        else if (in_ && Math.abs(in_) > 0) amount = Math.abs(in_);
      }
      if (amount === null || Math.abs(amount) < 0.005) continue;
      const description = String(r[cols.desc] ?? "").replace(/\s+/g, " ").trim() || "Bank transaction";
      const guess = guessCategory(description, amount);
      // Money in from a housemate is a bill repayment, not income — leave it unticked.
      const fromHousemate = amount > 0 && housemates.some((h) => h && new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(description));
      out.push({ key: i, include: !fromHousemate, fromHousemate, date, description, amount: round2(amount), ...guess, ...overrides[i] });
    }
    return out;
  }, [rows, headerRow, cols, amountMode, dateOrder, overrides, housemates]);

  const included = parsed.filter((r) => r.include);

  async function categorizeWithAi() {
    setBusy("ai");
    setError(null);
    try {
      const next = { ...overrides };
      for (let i = 0; i < parsed.length; i += 250) {
        const chunk = parsed.slice(i, i + 250);
        const res = await ai.categorize({ items: chunk.map((r) => ({ index: r.key, description: r.description, amount: r.amount })) });
        for (const x of res.results) next[x.index] = { ...next[x.index], category: x.category, subCategory: x.subCategory };
      }
      setOverrides(next);
      toast("Categories updated — check them before importing", "info");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function doImport() {
    setBusy("import");
    setError(null);
    try {
      const items: TransactionInput[] = included.map((r) => ({
        date: r.date,
        category: r.category,
        subCategory: r.subCategory,
        vendor: r.description.slice(0, 80),
        description: r.description,
        totalAmount: Math.abs(r.amount),
        consumptionUnits: null,
        isRecurring: false,
        split: null,
        source: "import",
        importHash: importHash(r.date, r.description, r.amount),
      }));
      const res = await importTransactions(items);
      toast(`Imported ${res.written} entr${res.written === 1 ? "y" : "ies"}${res.skipped ? `, skipped ${res.skipped} already imported` : ""}`);
      setSheets([]);
      setFileName(null);
      setOverrides({});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const colSelect = (label: string, key: keyof typeof cols) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: Number(e.target.value) })}>
          <option value={-1}>—</option>
          {headers.map((h, i) => (
            <option key={i} value={i}>
              {h}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const setRow = (key: number, patch: Partial<Row>) => setOverrides((o) => ({ ...o, [key]: { ...o[key], ...patch } }));

  return (
    <Panel title="Import a bank statement">
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {!sheets.length ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[60ch] text-ink-soft">
            Export your statement from Maybank2u, CIMB Clicks, RHB or any bank as Excel or CSV. You&rsquo;ll match the columns, check the categories, then import. Lines
            already imported are skipped.
          </p>
          <Button variant="primary" busy={busy === "read"} onClick={() => input.current?.click()}>
            <Icon name="upload" className="h-4 w-4" /> Choose file
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">{fileName}</p>
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
              Choose another file
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sheets.length > 1 && (
              <Field label="Sheet">
                {(id) => (
                  <Select id={id} value={sheetIdx} onChange={(e) => setup(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Header row">
              {(id) => (
                <Select id={id} value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  {rows.slice(0, 30).map((r, i) => (
                    <option key={i} value={i}>
                      Row {i + 1}: {r.slice(0, 3).map(String).join(" | ").slice(0, 40)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {colSelect("Date column", "date")}
            {colSelect("Description column", "desc")}
            <Field label="Dates are written">
              {(id) => (
                <Select id={id} value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}>
                  <option value="dmy">Day/Month/Year</option>
                  <option value="mdy">Month/Day/Year</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Segmented
              label="Amounts"
              value={amountMode}
              onChange={setAmountMode}
              options={[
                { value: "split", label: "Separate debit & credit" },
                { value: "single", label: "One amount column" },
              ]}
            />
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              {amountMode === "split" ? (
                <>
                  {colSelect("Money out (debit)", "debit")}
                  {colSelect("Money in (credit)", "credit")}
                </>
              ) : (
                colSelect("Amount (negative = money out)", "amount")
              )}
            </div>
          </div>

          {parsed.length === 0 ? (
            <Notice tone="warn">No transactions found with these settings. Check the header row and the date and amount columns.</Notice>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-soft">
                  {included.length} of {parsed.length} lines selected · money in{" "}
                  <span className="num text-ink">{formatRM(included.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0))}</span> · money out{" "}
                  <span className="num text-ink">{formatRM(-included.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0))}</span>
                </p>
                <Button onClick={categorizeWithAi} busy={busy === "ai"}>
                  <Icon name="sparkle" className="h-4 w-4" /> Sort categories with AI
                </Button>
              </div>
              <div className="max-h-[480px] overflow-auto rounded-[var(--radius-control)] border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-paper text-ink-soft">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">Include</span>
                      </th>
                      <th className="px-2 py-2 font-medium">Date</th>
                      <th className="px-2 py-2 font-medium">Description</th>
                      <th className="px-2 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {parsed.map((r) => (
                      <tr key={r.key} className={cx(!r.include && "opacity-45")}>
                        <td className="px-3 py-1.5">
                          <Checkbox label={<span className="sr-only">Include</span>} checked={r.include} onChange={(v) => setRow(r.key, { include: v })} />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-ink-soft">{formatDate(r.date)}</td>
                        <td className="max-w-[280px] truncate px-2 py-1.5" title={r.description}>
                          {r.description}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <select
                              aria-label="Type"
                              className="rounded-md border border-line bg-surface px-1.5 py-1"
                              value={r.category}
                              onChange={(e) => {
                                const c = e.target.value as Category;
                                setRow(r.key, { category: c, subCategory: subCategoriesFor(c).includes(r.subCategory) ? r.subCategory : subCategoriesFor(c)[0] });
                              }}
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                            <select aria-label="Kind" className="rounded-md border border-line bg-surface px-1.5 py-1" value={r.subCategory} onChange={(e) => setRow(r.key, { subCategory: e.target.value })}>
                              {subCategoriesFor(r.category).map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className={cx("num px-3 py-1.5 text-right whitespace-nowrap", r.amount > 0 && "text-settled")}>{formatRM(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.some((r) => r.fromHousemate) && (
                <Notice tone="info">Transfers from housemates are unticked — they&rsquo;re bill repayments, not income. Record them in Settle up instead.</Notice>
              )}
              <p className="text-xs text-ink-faint">
                House bills come in without a split. Open one later and turn on &ldquo;Split with housemates&rdquo; to charge each person their share.
              </p>
              <div className="flex justify-end">
                <Button variant="primary" busy={busy === "import"} disabled={included.length === 0} onClick={doImport}>
                  Import {included.length} entr{included.length === 1 ? "y" : "ies"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
