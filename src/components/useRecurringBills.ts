"use client";

import { useEffect, useRef } from "react";
import { generateDueRecurringBills, missingOccurrences } from "@/lib/recurring";
import { useData } from "./providers/DataProvider";
import { useToast } from "./providers/ToastProvider";

/**
 * When the dashboard mounts, create any recurring bills that are due but
 * missing (this replaces the old scheduled Cloud Function).
 */
export function useRecurringBills() {
  const { transactions, settings, ready } = useData();
  const toast = useToast();
  const ran = useRef(false);

  useEffect(() => {
    if (!ready || ran.current) return;
    ran.current = true;
    if (missingOccurrences(transactions).length === 0) return;
    generateDueRecurringBills(transactions, settings.adminName).then((res) => {
      if (res.created.length) {
        toast(res.created.length === 1 ? `Added ${res.created[0]}` : `Added ${res.created.length} recurring bills`, "info");
      }
      if (res.failed.length) toast(`Couldn't add ${res.failed.length} recurring bill${res.failed.length > 1 ? "s" : ""}. Try "Create due bills now" in Settings.`, "error");
    });
    // Run once per visit to the dashboard; the snapshot is already loaded when ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
