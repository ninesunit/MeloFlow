"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BarChart, type Bar } from "@/components/BarChart";
import { BillDetail } from "@/components/BillDetail";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { errorText } from "@/components/providers/ToastProvider";
import { Button, cx, EmptyState, Notice, PageHeader, Panel, Segmented } from "@/components/ui";
import { ai } from "@/lib/ai";
import type { AnalyzeUtilitiesResponse, ForecastResponse } from "@/lib/shared/ai-types";
import { formatDate, formatMonth, monthKey } from "@/lib/shared/dates";
import { formatRM, round2 } from "@/lib/shared/money";
import { baselineForecast, detectAnomalies, monthlySeries, unitLabel, utilityBills, type UtilityKind } from "@/lib/shared/utilities";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (key: string) => `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

export default function UtilitiesPage() {
  const { transactions, settings } = useData();
  const [kind, setKind] = useState<UtilityKind>("Electric");
  const [selected, setSelected] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalyzeUtilitiesResponse | undefined>>({});
  const [aiForecast, setAiForecast] = useState<Record<string, ForecastResponse | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bills = useMemo(() => utilityBills(transactions, kind), [transactions, kind]);
  const series = useMemo(() => monthlySeries(bills).slice(-12), [bills]);
  const anomaly = useMemo(() => detectAnomalies(transactions, settings.monthlyUtilityCaps).find((a) => a.kind === kind) ?? null, [transactions, settings.monthlyUtilityCaps, kind]);
  const forecast = useMemo(() => baselineForecast(transactions, kind), [transactions, kind]);
  const unit = unitLabel(kind);
  const cap = settings.monthlyUtilityCaps[kind] ?? 0;
  const ai1 = analysis[`${kind}-${anomaly?.bill.id}`];
  const ai2 = aiForecast[`${kind}-${forecast?.targetMonth}`];

  const bars: Bar[] = series.map((s) => ({
    label: shortMonth(s.month),
    value: s.amount,
    sub: s.units !== null ? `${s.units} ${unit}` : undefined,
    tone: cap > 0 && s.amount > cap ? "alert" : "normal",
  }));
  if (forecast) bars.push({ label: `${shortMonth(forecast.targetMonth)} (forecast)`, value: ai2?.amount ?? forecast.amount, tone: "forecast" });

  async function explain() {
    if (!anomaly) return;
    setBusy("explain");
    setError(null);
    try {
      const history = monthlySeries(anomaly.history);
      const res = await ai.analyzeUtilities({
        kind,
        current: { month: monthKey(anomaly.bill.date), amount: anomaly.bill.totalAmount, units: anomaly.bill.consumptionUnits ?? null },
        history,
        averageAmount: anomaly.avgCost,
        averageUnits: anomaly.avgUnits,
        costChangePercent: round2(anomaly.costChange * 100),
        unitsChangePercent: anomaly.unitsChange === null ? null : round2(anomaly.unitsChange * 100),
      });
      setAnalysis((a) => ({ ...a, [`${kind}-${anomaly.bill.id}`]: res }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function askForecast() {
    if (!forecast) return;
    setBusy("forecast");
    setError(null);
    try {
      const res = await ai.forecastUtilities({
        kind,
        targetMonth: forecast.targetMonth,
        history: monthlySeries(bills).slice(-24),
        baseline: { amount: forecast.amount, units: forecast.units, low: forecast.low, high: forecast.high },
      });
      setAiForecast((f) => ({ ...f, [`${kind}-${forecast.targetMonth}`]: res }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Utilities"
        description="Electricity and water over time, with spike alerts and next month's forecast."
        actions={
          <Segmented<UtilityKind>
            label="Utility"
            value={kind}
            onChange={setKind}
            options={[
              { value: "Electric", label: "Electricity" },
              { value: "Water", label: "Water" },
            ]}
          />
        }
      />

      {bills.length === 0 ? (
        <EmptyState title={`No ${kind === "Electric" ? "TNB" : "water"} bills yet`}>
          Add {kind === "Electric" ? "electricity" : "water"} bills as shared house bills with their usage in {unit}. After two or three months you&rsquo;ll see trends,
          spike alerts and a forecast here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <Panel title="Monthly cost" action={cap > 0 ? <span className="num text-sm text-ink-soft">Cap {formatRM(cap)}</span> : <Link className="text-sm text-violet" href="/settings/">Set a monthly cap</Link>}>
            <BarChart bars={bars} format={formatRM} average={anomaly?.avgCost || null} />
            <p className="mt-3 text-xs text-ink-faint">Dashed line: 3-month average. Outlined bar: forecast. Red bars went over your cap.</p>
          </Panel>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Latest bill vs. 3-month average">
              {anomaly && anomaly.history.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label={`${formatMonth(monthKey(anomaly.bill.date))}`} value={formatRM(anomaly.bill.totalAmount)} sub={anomaly.bill.consumptionUnits != null ? `${anomaly.bill.consumptionUnits} ${unit}` : undefined} />
                    <Stat label="Average before it" value={formatRM(anomaly.avgCost)} sub={anomaly.avgUnits != null ? `${anomaly.avgUnits} ${unit}` : undefined} />
                  </div>
                  <p className={cx("text-[1.05rem]", anomaly.isSpike ? "text-pending" : "text-ink")}>
                    Cost {anomaly.costChange >= 0 ? "up" : "down"} <span className="num font-semibold">{Math.abs(Math.round(anomaly.costChange * 100))}%</span>
                    {anomaly.unitsChange !== null && (
                      <>
                        , usage {anomaly.unitsChange >= 0 ? "up" : "down"} <span className="num font-semibold">{Math.abs(Math.round(anomaly.unitsChange * 100))}%</span>
                      </>
                    )}
                    . {anomaly.isSpike ? "That's a spike — more than 20% above normal." : "Within the normal range."}
                  </p>
                  {ai1 ? (
                    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-paper px-4 py-3 text-sm">
                      <p>{ai1.summary}</p>
                      <p className="font-semibold">Likely causes</p>
                      <ul className="list-disc pl-5 text-ink-soft">
                        {ai1.likelyCauses.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                      <p className="font-semibold">What to try</p>
                      <ul className="list-disc pl-5 text-ink-soft">
                        {ai1.suggestions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <Button onClick={explain} busy={busy === "explain"} className="w-fit">
                      <Icon name="sparkle" className="h-4 w-4" /> Explain this with AI
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-ink-soft">Add at least two months of bills to compare against an average.</p>
              )}
            </Panel>

            <Panel title={forecast ? `Forecast for ${formatMonth(forecast.targetMonth)}` : "Forecast"}>
              {forecast ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Statistical estimate" value={formatRM(forecast.amount)} sub={`${formatRM(forecast.low)} – ${formatRM(forecast.high)}`} />
                    {ai2 ? (
                      <Stat label="AI forecast" value={formatRM(ai2.amount)} sub={`${formatRM(ai2.low)} – ${formatRM(ai2.high)}${ai2.units != null ? ` · ~${round2(ai2.units)} ${unit}` : ""}`} />
                    ) : (
                      forecast.units != null && <Stat label="Expected usage" value={`${forecast.units} ${unit}`} />
                    )}
                  </div>
                  <p className="text-sm text-ink-soft">{ai2 ? ai2.reasoning : `${forecast.basis}, from ${forecast.historyCount} month${forecast.historyCount > 1 ? "s" : ""} of bills.`}</p>
                  {!ai2 && (
                    <Button onClick={askForecast} busy={busy === "forecast"} className="w-fit">
                      <Icon name="sparkle" className="h-4 w-4" /> Forecast with AI
                    </Button>
                  )}
                  {cap > 0 && (ai2?.amount ?? forecast.amount) > cap && <Notice tone="warn">The forecast is above your {formatRM(cap)} cap.</Notice>}
                </div>
              ) : (
                <p className="text-ink-soft">Add a bill from a previous month to see a forecast.</p>
              )}
            </Panel>
          </div>

          <Panel title="Bill history" padded={false}>
            <table className="w-full text-left text-[0.95rem]">
              <thead className="border-b border-line bg-paper/60 text-sm text-ink-soft">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Bill date</th>
                  <th className="px-3 py-2.5 text-right font-medium">Usage</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">RM per {unit}</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...bills].reverse().map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-paper/50" onClick={() => setSelected(b.id)}>
                    <td className="px-5 py-2.5">
                      {formatDate(b.date)}
                      <span className="block text-sm text-ink-soft">{b.vendor}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{b.consumptionUnits != null ? `${b.consumptionUnits} ${unit}` : "—"}</td>
                    <td className="num hidden px-3 py-2.5 text-right text-ink-soft sm:table-cell">
                      {b.consumptionUnits ? formatRM(b.totalAmount / b.consumptionUnits) : "—"}
                    </td>
                    <td className={cx("num px-5 py-2.5 text-right font-medium", cap > 0 && b.totalAmount > cap && "text-pending")}>{formatRM(b.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
      <BillDetail transactionId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="num text-[1.45rem] font-semibold">{value}</p>
      {sub && <p className="num text-sm text-ink-soft">{sub}</p>}
    </div>
  );
}
