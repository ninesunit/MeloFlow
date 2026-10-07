"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useAuth } from "@/components/providers/AuthProvider";
import { useData } from "@/components/providers/DataProvider";
import { errorText, useToast } from "@/components/providers/ToastProvider";
import { Button, Checkbox, Field, Input, Notice, PageHeader, Panel, Textarea } from "@/components/ui";
import { useRecurringNow } from "@/components/useRecurringNow";
import { useStoredFile } from "@/components/useStoredFile";
import { saveSettings } from "@/lib/db";
import { compressImage, deleteStoredFile, saveFile } from "@/lib/files";
import { normalisePhone } from "@/lib/shared/message";
import { formatRM } from "@/lib/shared/money";
import type { Housemate, TariffSettings } from "@/lib/shared/types";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Housemates, payment details, utility caps and tariff options." />
      <div className="grid gap-6 lg:grid-cols-2">
        <HouseholdPanel />
        <PaymentPanel />
        <CapsPanel />
        <TariffPanel />
        <RecurringPanel />
        <AccountPanel />
      </div>
    </>
  );
}

function useSaver() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok = "Saved") => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function HouseholdPanel() {
  const { settings, receivables, balances } = useData();
  const { busy, run } = useSaver();
  const [adminName, setAdminName] = useState(settings.adminName);
  const [mates, setMates] = useState<Housemate[]>(settings.housemates);
  const [error, setError] = useState<string | null>(null);

  const hasHistory = (name: string) => receivables.some((r) => r.debtorName === name) || Math.abs(balances[name] ?? 0) > 0.004;
  const renamed = settings.housemates.filter((h, i) => mates[i] && mates[i].name !== h.name && hasHistory(h.name));
  const removed = settings.housemates.filter((h) => !mates.some((m) => m.name === h.name) && hasHistory(h.name));

  function save() {
    const names = [adminName.trim(), ...mates.map((m) => m.name.trim())];
    if (names.some((n) => !n)) return setError("Every person needs a name.");
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return setError("Names must be different from each other.");
    setError(null);
    run(() => saveSettings({ adminName: adminName.trim(), housemates: mates.map((m) => ({ name: m.name.trim(), phone: normalisePhone(m.phone) })) }));
  }

  return (
    <Panel title="Household">
      <div className="flex flex-col gap-4">
        <Field label="Your name (the main tenant)" hint="Shown on messages and used as the person who pays any rounding.">
          {(id) => <Input id={id} value={adminName} onChange={(e) => setAdminName(e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-ink-soft">Housemates</p>
          {mates.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.3fr_auto] items-center gap-2">
              <Input aria-label={`Housemate ${i + 1} name`} placeholder="Name" value={m.name} onChange={(e) => setMates(mates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={`Housemate ${i + 1} WhatsApp number`} inputMode="tel" placeholder="WhatsApp, e.g. 012-345 6789" value={m.phone} onChange={(e) => setMates(mates.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label={`Remove ${m.name || "housemate"}`} onClick={() => setMates(mates.filter((_, j) => j !== i))}>
                <Icon name="trash" className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" className="w-fit" onClick={() => setMates([...mates, { name: "", phone: "" }])}>
            <Icon name="plus" className="h-4 w-4" /> Add housemate
          </Button>
        </div>
        {(renamed.length > 0 || removed.length > 0) && (
          <Notice tone="warn">
            {[...renamed, ...removed].map((h) => h.name).join(", ")} already {renamed.length + removed.length > 1 ? "have" : "has"} bills or a balance. Their history stays under the old
            name; renaming or removing only affects new bills.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button variant="primary" className="w-fit" busy={busy} onClick={save}>
          Save household
        </Button>
      </div>
    </Panel>
  );
}

function PaymentPanel() {
  const { settings } = useData();
  const { busy, run } = useSaver();
  const toast = useToast();
  const [bank, setBank] = useState(settings.bankAccountDetails ?? "");
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qr = useStoredFile(settings.duitNowQrFileId);

  async function onQr(file: File) {
    if (!file.type.startsWith("image/")) return toast("Choose an image of your DuitNow QR.", "error");
    setUploading(true);
    try {
      // QR codes stay scannable at this size; it keeps the file well under Firestore's limit.
      const small = await compressImage(file, { maxDim: 1000, maxBytes: 300 * 1024 });
      const id = await saveFile(small, "duitnow-qr.jpg", "payment");
      const old = settings.duitNowQrFileId;
      await saveSettings({ duitNowQrFileId: id });
      await deleteStoredFile(old);
      toast("DuitNow QR saved");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Panel title="Payment details">
      <div className="flex flex-col gap-4">
        <Field label="Bank account" hint="Added to every bill message.">
          {(id) => <Textarea id={id} rows={3} placeholder={"Maybank 1234 5678 9012\nAlia binti Ahmad"} value={bank} onChange={(e) => setBank(e.target.value)} />}
        </Field>
        <Button className="w-fit" busy={busy} onClick={() => run(() => saveSettings({ bankAccountDetails: bank.trim() }))}>
          Save bank details
        </Button>
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-sm font-medium text-ink-soft">DuitNow QR</p>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onQr(e.target.files[0])} />
          <div className="flex items-start gap-4">
            {qr.file ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.file.dataUrl} alt="Your DuitNow QR code" className="h-28 w-28 rounded-[var(--radius-control)] border border-line object-contain" />
            ) : settings.duitNowQrFileId ? (
              <div className="flex h-28 w-28 items-center justify-center rounded-[var(--radius-control)] border border-line text-center text-xs text-ink-faint">{qr.error ?? "Loading…"}</div>
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line text-center text-xs text-ink-faint">No QR yet</div>
            )}
            <div className="flex flex-col gap-2">
              <Button size="sm" busy={uploading} onClick={() => input.current?.click()}>
                <Icon name="upload" className="h-4 w-4" /> {settings.duitNowQrFileId ? "Replace QR" : "Upload QR"}
              </Button>
              {settings.duitNowQrFileId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      const old = settings.duitNowQrFileId;
                      await saveSettings({ duitNowQrFileId: null });
                      await deleteStoredFile(old);
                    }, "QR removed")
                  }
                >
                  Remove
                </Button>
              )}
              <p className="max-w-[28ch] text-xs text-ink-faint">A link to it is added to bill messages so housemates can scan and pay.</p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function CapsPanel() {
  const { settings } = useData();
  const { busy, run } = useSaver();
  const [elec, setElec] = useState(String(settings.monthlyUtilityCaps.Electric || ""));
  const [water, setWater] = useState(String(settings.monthlyUtilityCaps.Water || ""));
  return (
    <Panel title="Monthly utility caps">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">You&rsquo;ll get a warning on the dashboard when a bill or forecast goes over these. Leave blank for no cap.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Electricity (RM)">{(id) => <Input id={id} type="number" min="0" value={elec} onChange={(e) => setElec(e.target.value)} />}</Field>
          <Field label="Water (RM)">{(id) => <Input id={id} type="number" min="0" value={water} onChange={(e) => setWater(e.target.value)} />}</Field>
        </div>
        <Button className="w-fit" busy={busy} onClick={() => run(() => saveSettings({ monthlyUtilityCaps: { Electric: Math.max(0, Number(elec) || 0), Water: Math.max(0, Number(water) || 0) } }))}>
          Save caps
        </Button>
      </div>
    </Panel>
  );
}

function TariffPanel() {
  const { settings } = useData();
  const { busy, run } = useSaver();
  const [t, setT] = useState<TariffSettings>(settings.tariffs);
  const [afa, setAfa] = useState(String(settings.tariffs.afaSenPerKwh ?? 0));
  return (
    <Panel title="Electricity tariff options">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">Used by the bill estimator. The fuel adjustment (AFA) is announced by TNB each month and can be negative.</p>
        <Field label="Fuel adjustment, AFA (sen/kWh)" hint="Check the latest rate on the TNB website.">
          {(id) => <Input id={id} type="number" step="0.01" value={afa} onChange={(e) => setAfa(e.target.value)} />}
        </Field>
        <Checkbox label="Energy efficiency rebate (usage up to 1,000 kWh)" checked={t.includeEei} onChange={(v) => setT({ ...t, includeEei: v })} />
        <Checkbox label="KWTBB 1.6% (usage above 300 kWh)" checked={t.includeKwtbb} onChange={(v) => setT({ ...t, includeKwtbb: v })} />
        <Checkbox label="Service tax 8% (usage above 600 kWh)" checked={t.includeSst} onChange={(v) => setT({ ...t, includeSst: v })} />
        <Button className="w-fit" busy={busy} onClick={() => run(() => saveSettings({ tariffs: { ...t, afaSenPerKwh: Number(afa) || 0 } }))}>
          Save tariff options
        </Button>
      </div>
    </Panel>
  );
}

function RecurringPanel() {
  const { transactions } = useData();
  const { busy, result, runNow } = useRecurringNow();
  const templates = transactions.filter((t) => t.isRecurring);

  return (
    <Panel title="Recurring bills">
      <div className="flex flex-col gap-4">
        {templates.length === 0 ? (
          <p className="text-ink-soft">None yet. Tick &ldquo;Repeat this automatically&rdquo; when adding rent or Wi-Fi.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {templates.map((t) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span>
                  {t.subCategory} · {t.vendor}
                  <span className="text-ink-soft">
                    {" "}
                    — {t.frequency === "Yearly" ? "yearly" : "monthly"} on day {t.recurrenceDay}
                  </span>
                </span>
                <span className="num">{formatRM(t.totalAmount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-soft">
          Each period&rsquo;s copy is created when you open the dashboard on or after its day — including any months you missed. Use this to create them right now.
        </p>
        <Button className="w-fit" busy={busy} onClick={runNow}>
          Create due bills now
        </Button>
        {result && (
          <ul className="list-disc pl-5 text-sm text-ink-soft">
            {result.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function AccountPanel() {
  const { user, signOut } = useAuth();
  return (
    <Panel title="Account">
      <div className="flex flex-col gap-3">
        <p className="text-ink-soft">
          Signed in as <span className="font-medium text-ink">{user?.email}</span>. This is the only account that can open MeloFlow.
        </p>
        <Button className="w-fit" onClick={() => signOut()}>
          <Icon name="logout" className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </Panel>
  );
}
