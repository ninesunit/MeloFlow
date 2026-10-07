"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { useData } from "@/components/providers/DataProvider";
import { errorText, useToast } from "@/components/providers/ToastProvider";
import { Button, Dialog, EmptyState, Field, Input, Money, Notice, PageHeader, Panel, Segmented, Select } from "@/components/ui";
import { deleteAppliance, saveAppliance } from "@/lib/db";
import { formatRM, round2 } from "@/lib/shared/money";
import { airconWatts, APPLIANCE_PRESETS, effectiveWatts, monthlyKwh, monthlyWaterM3, totals } from "@/lib/shared/estimator";
import { electricityCost, waterCost } from "@/lib/shared/tariffs";
import type { Appliance, ApplianceType } from "@/lib/shared/types";
import { utilityBills } from "@/lib/shared/utilities";

type Draft = Omit<Appliance, "id"> & { id?: string };

const blank = (type: ApplianceType): Draft => ({
  name: "",
  type,
  quantity: 1,
  powerRatingWatts: 0,
  estimatedDailyHours: 0,
  dutyCyclePercent: 100,
  horsepower: null,
  waterVolumeCubicMeters: 0,
  usesPerWeek: 0,
});

export default function EstimatorPage() {
  const { appliances, settings, transactions, people } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);

  const t = useMemo(() => totals(appliances), [appliances]);
  const elec = useMemo(() => electricityCost(t.kwh, settings.tariffs), [t.kwh, settings.tariffs]);
  const water = useMemo(() => waterCost(t.m3), [t.m3]);
  const lastElec = utilityBills(transactions, "Electric").at(-1);
  const lastWater = utilityBills(transactions, "Water").at(-1);
  const total = round2(elec.total + water.total);
  const perPerson = people.length ? round2(total / people.length) : total;

  const electrical = appliances.filter((a) => a.type === "Electrical").sort((a, b) => monthlyKwh(b) - monthlyKwh(a));
  const waterUses = appliances.filter((a) => a.type === "Water").sort((a, b) => monthlyWaterM3(b) - monthlyWaterM3(a));

  async function remove(a: Appliance) {
    if (!confirm(`Remove ${a.name}?`)) return;
    try {
      await deleteAppliance(a.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function addPresets() {
    try {
      for (const p of APPLIANCE_PRESETS.filter((x) => ["Air-conditioner 1.0 HP", "Refrigerator", "Ceiling fan", "Water heater", "Washing machine", "Wi-Fi router", "Shower (8 min)", "Washing machine load", "Toilet flush"].includes(x.name))) {
        await saveAppliance(p);
      }
      toast("Added a typical house setup — adjust it to match yours");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Bill estimator"
        description="List what's plugged in and how often water runs, and see roughly what TNB and Air Selangor will charge."
        actions={
          <>
            <Button onClick={() => setEditing(blank("Water"))}>
              <Icon name="drop" className="h-4 w-4" /> Add water use
            </Button>
            <Button variant="primary" onClick={() => setEditing(blank("Electrical"))}>
              <Icon name="bolt" className="h-4 w-4" /> Add appliance
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          {appliances.length === 0 ? (
            <EmptyState title="No appliances yet" action={<Button onClick={addPresets}>Start with a typical house</Button>}>
              Add your air-cons, fridge, water heater and so on, or start from a typical three-person house and edit the hours.
            </EmptyState>
          ) : (
            <>
              <ApplianceList title="Electricity" items={electrical} render={(a) => `${effectiveWatts(a)} W × ${a.estimatedDailyHours} h/day${a.dutyCyclePercent < 100 ? ` at ${a.dutyCyclePercent}%` : ""}`} value={(a) => `${monthlyKwh(a)} kWh`} onEdit={setEditing} onDelete={remove} />
              <ApplianceList title="Water" items={waterUses} render={(a) => `${round2(a.waterVolumeCubicMeters * 1000)} L × ${a.usesPerWeek} a week`} value={(a) => `${monthlyWaterM3(a)} m³`} onEdit={setEditing} onDelete={remove} />
            </>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-[var(--radius-panel)] bg-plum px-6 py-5 text-white">
            <p className="text-sm text-white/60">Estimated monthly utilities</p>
            <p className="num mt-1 text-[2.4rem] leading-none font-semibold">{formatRM(total)}</p>
            <p className="num mt-2 text-sm text-white/65">
              about {formatRM(perPerson)} each for {people.length} people
            </p>
          </section>

          <Panel title={`Electricity · ${t.kwh} kWh`}>
            <Breakdown lines={elec.lines.filter((l) => l.amount !== 0)} total={elec.total} />
            {lastElec && (
              <p className="mt-3 text-sm text-ink-soft">
                Last real bill: <Money value={lastElec.totalAmount} className="text-ink" />
                {lastElec.consumptionUnits != null && ` for ${lastElec.consumptionUnits} kWh`}
              </p>
            )}
          </Panel>
          <Panel title={`Water · ${t.m3} m³`}>
            <Breakdown lines={water.lines} total={water.total} />
            {lastWater && (
              <p className="mt-3 text-sm text-ink-soft">
                Last real bill: <Money value={lastWater.totalAmount} className="text-ink" />
                {lastWater.consumptionUnits != null && ` for ${lastWater.consumptionUnits} m³`}
              </p>
            )}
          </Panel>
          <p className="text-xs text-ink-faint">
            Uses the TNB domestic tariff from July 2025 (27.03 sen/kWh up to 1,500 kWh, 37.03 sen above, plus capacity, network and retail charges) and the Air Selangor
            domestic tariff from September 2025. Fuel adjustment and taxes can be changed in Settings. Estimates only.
          </p>
        </div>
      </div>

      {editing && <ApplianceDialog draft={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ApplianceList({ title, items, render, value, onEdit, onDelete }: { title: string; items: Appliance[]; render: (a: Appliance) => string; value: (a: Appliance) => string; onEdit: (a: Appliance) => void; onDelete: (a: Appliance) => void }) {
  if (items.length === 0) return null;
  return (
    <Panel title={title} padded={false}>
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {a.name}
                {a.quantity > 1 && <span className="text-ink-soft"> × {a.quantity}</span>}
              </p>
              <p className="num text-sm text-ink-soft">{render(a)}</p>
            </div>
            <div className="flex items-center gap-1">
              <span className="num mr-2 font-medium whitespace-nowrap">{value(a)}</span>
              <Button size="sm" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => onEdit(a)}>
                <Icon name="edit" className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${a.name}`} onClick={() => onDelete(a)}>
                <Icon name="trash" className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Breakdown({ lines, total }: { lines: { label: string; amount: number }[]; total: number }) {
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-3">
          <dt className="text-ink-soft">{l.label}</dt>
          <dd className="num">{formatRM(l.amount)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
        <dt>Total</dt>
        <dd className="num">{formatRM(total)}</dd>
      </div>
    </dl>
  );
}

function ApplianceDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAircon = d.type === "Electrical" && (d.horsepower ?? 0) > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const num = (s: string) => (s === "" ? 0 : Number(s));
  const presets = APPLIANCE_PRESETS.filter((p) => p.type === d.type);

  async function save() {
    if (!d.name.trim()) return setError("Give it a name.");
    if (d.type === "Electrical" && !(effectiveWatts(d) > 0)) return setError("Enter the wattage, or horsepower for an air-con.");
    if (d.type === "Water" && !(d.waterVolumeCubicMeters > 0)) return setError("Enter how many litres each use takes.");
    setBusy(true);
    try {
      await saveAppliance({ ...d, name: d.name.trim() });
      toast("Saved");
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const preview = d.type === "Electrical" ? `${monthlyKwh({ ...d, id: "x" })} kWh a month` : `${monthlyWaterM3({ ...d, id: "x" })} m³ a month`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={draft.id ? `Edit ${draft.name}` : d.type === "Electrical" ? "Add appliance" : "Add water use"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!draft.id && (
          <Field label="Start from a typical value">
            {(id) => (
              <Select
                id={id}
                value=""
                onChange={(e) => {
                  const p = presets.find((x) => x.name === e.target.value);
                  if (p) setD({ ...p });
                }}
              >
                <option value="">Choose…</option>
                {presets.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Name">{(id) => <Input id={id} value={d.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="How many">{(id) => <Input id={id} type="number" min={1} value={d.quantity} onChange={(e) => set("quantity", Math.max(1, num(e.target.value)))} />}</Field>
        </div>
        {d.type === "Electrical" ? (
          <>
            <Segmented
              label="Power from"
              value={isAircon ? "hp" : "watts"}
              onChange={(v) => setD((x) => (v === "hp" ? { ...x, horsepower: x.horsepower || 1, powerRatingWatts: 0, dutyCyclePercent: x.dutyCyclePercent === 100 ? 70 : x.dutyCyclePercent } : { ...x, horsepower: null }))}
              options={[
                { value: "watts", label: "Wattage" },
                { value: "hp", label: "Air-con horsepower" },
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              {isAircon ? (
                <Field label="Horsepower" hint={`≈ ${airconWatts(d.horsepower ?? 0)} W`}>
                  {(id) => <Input id={id} type="number" step="0.5" min="0.5" value={d.horsepower ?? ""} onChange={(e) => set("horsepower", num(e.target.value))} />}
                </Field>
              ) : (
                <Field label="Watts" hint="On the label or manual.">
                  {(id) => <Input id={id} type="number" min="0" value={d.powerRatingWatts || ""} onChange={(e) => set("powerRatingWatts", num(e.target.value))} />}
                </Field>
              )}
              <Field label="Hours a day">{(id) => <Input id={id} type="number" step="0.25" min="0" max="24" value={d.estimatedDailyHours || ""} onChange={(e) => set("estimatedDailyHours", Math.min(24, num(e.target.value)))} />}</Field>
              <Field label="Running at" hint="% of the time drawing full power (fridges ~40%, air-cons ~60–80%).">
                {(id) => <Input id={id} type="number" min="1" max="100" value={d.dutyCyclePercent} onChange={(e) => set("dutyCyclePercent", Math.min(100, Math.max(1, num(e.target.value))))} />}
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Litres each time" hint="Top-load washer ~100 L, front-load ~50 L, 8-min shower ~70 L.">
              {(id) => <Input id={id} type="number" min="0" value={d.waterVolumeCubicMeters ? round2(d.waterVolumeCubicMeters * 1000) : ""} onChange={(e) => set("waterVolumeCubicMeters", num(e.target.value) / 1000)} />}
            </Field>
            <Field label="Times a week (whole house)">{(id) => <Input id={id} type="number" min="0" value={d.usesPerWeek || ""} onChange={(e) => set("usesPerWeek", num(e.target.value))} />}</Field>
          </div>
        )}
        <p className="num text-sm text-ink-soft">≈ {preview}</p>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}
