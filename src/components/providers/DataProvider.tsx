"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureSettings, subscribe, subscribeSettings } from "@/lib/db";
import type { Appliance, Balance, BalanceEvent, Receivable, Transaction, UserSettings } from "@/lib/shared/types";
import { DEFAULT_TARIFFS, defaultSettings } from "@/lib/shared/types";
import { useAuth } from "./AuthProvider";

interface DataState {
  ready: boolean;
  error: string | null;
  transactions: Transaction[];
  receivables: Receivable[];
  balances: Record<string, number>;
  balanceEvents: BalanceEvent[];
  appliances: Appliance[];
  settings: UserSettings;
  /** Housemate names (everyone except the admin). */
  housemates: string[];
  /** Everyone who can share a bill, admin first. */
  people: string[];
  receivablesByTx: Map<string, Receivable[]>;
}

const DataContext = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}

/** Live Firestore subscriptions for the whole app (single user, modest data). */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [balancesList, setBalances] = useState<Balance[] | null>(null);
  const [balanceEvents, setEvents] = useState<BalanceEvent[]>([]);
  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [settingsDoc, setSettingsDoc] = useState<UserSettings | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const onError = (e: Error) => setError(e.message);
    const unsubs = [
      subscribe<Transaction>("transactions", setTransactions, onError, "date"),
      subscribe<Receivable>("receivables", setReceivables, onError),
      subscribe<Balance>("balances", setBalances, onError),
      subscribe<BalanceEvent>("balanceEvents", setEvents, onError, "at"),
      subscribe<Appliance>("appliances", setAppliances, onError),
      subscribeSettings(setSettingsDoc, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  useEffect(() => {
    if (user && settingsDoc !== undefined) {
      ensureSettings(user.uid, settingsDoc).catch((e: Error) => setError(e.message));
    }
  }, [user, settingsDoc]);

  const value = useMemo<DataState>(() => {
    const base = defaultSettings(user?.uid ?? "");
    const settings: UserSettings = {
      id: "main",
      ...base,
      ...(settingsDoc ?? {}),
      monthlyUtilityCaps: { ...base.monthlyUtilityCaps, ...(settingsDoc?.monthlyUtilityCaps ?? {}) },
      tariffs: { ...DEFAULT_TARIFFS, ...(settingsDoc?.tariffs ?? {}) },
      personalBudgetCaps: settingsDoc?.personalBudgetCaps ?? {},
      housemates: settingsDoc?.housemates?.length ? settingsDoc.housemates : base.housemates,
    };
    const housemates = settings.housemates.map((h) => h.name).filter(Boolean);
    const balances: Record<string, number> = {};
    for (const b of balancesList ?? []) balances[b.debtorName] = b.runningBalance;
    const receivablesByTx = new Map<string, Receivable[]>();
    for (const r of receivables ?? []) {
      const list = receivablesByTx.get(r.transactionId) ?? [];
      list.push(r);
      receivablesByTx.set(r.transactionId, list);
    }
    return {
      ready: transactions !== null && receivables !== null && balancesList !== null && settingsDoc !== undefined,
      error,
      transactions: transactions ?? [],
      receivables: receivables ?? [],
      balances,
      balanceEvents,
      appliances,
      settings,
      housemates,
      people: [settings.adminName, ...housemates],
      receivablesByTx,
    };
  }, [transactions, receivables, balancesList, balanceEvents, appliances, settingsDoc, error, user]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
