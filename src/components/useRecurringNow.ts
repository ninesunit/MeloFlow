"use client";

import { useState } from "react";
import { generateDueRecurringBills } from "@/lib/recurring";
import { useData } from "./providers/DataProvider";
import { useToast } from "./providers/ToastProvider";

/** "Create due bills now" in Settings — the same generator the dashboard runs. */
export function useRecurringNow() {
  const { transactions, settings } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  async function runNow() {
    setBusy(true);
    try {
      const res = await generateDueRecurringBills(transactions, settings.adminName);
      const lines = [...res.created.map((c) => `Created ${c}`), ...res.failed.map((f) => `Failed: ${f}`)];
      setResult(lines.length ? lines : ["Nothing new to create — every recurring bill that's due already exists."]);
      toast(res.created.length ? `Created ${res.created.length} bill${res.created.length > 1 ? "s" : ""}` : "Already up to date", "info");
    } finally {
      setBusy(false);
    }
  }

  return { busy, result, runNow };
}
