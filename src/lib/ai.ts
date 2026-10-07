"use client";

import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type {
  AnalyzeUtilitiesRequest,
  AnalyzeUtilitiesResponse,
  CategorizeRequest,
  CategorizeResponse,
  ComposeMessageRequest,
  ComposeMessageResponse,
  ForecastRequest,
  ForecastResponse,
  ParseBillRequest,
  ParsedBill,
  RunRecurringResponse,
} from "./shared/ai-types";

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  try {
    const fn = httpsCallable<Req, Res>(functions(), name, { timeout: 120_000 });
    const res = await fn(data);
    return res.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "functions/not-found" || (err.code === "functions/internal" && /not found/i.test(err.message ?? ""))) {
      throw new Error("The AI functions aren't deployed yet. Deploy Cloud Functions (see README) and try again.");
    }
    if (err.code === "functions/failed-precondition") throw new Error(err.message ?? "AI is not configured.");
    if (err.code === "functions/permission-denied") throw new Error("Only the administrator account can use this.");
    throw new Error(err.message || "The AI request failed. Try again in a moment.");
  }
}

export const ai = {
  parseBill: (req: ParseBillRequest) => call<ParseBillRequest, ParsedBill>("parseBill", req),
  composeMessage: (req: ComposeMessageRequest) => call<ComposeMessageRequest, ComposeMessageResponse>("composeMessage", req),
  analyzeUtilities: (req: AnalyzeUtilitiesRequest) => call<AnalyzeUtilitiesRequest, AnalyzeUtilitiesResponse>("analyzeUtilities", req),
  forecastUtilities: (req: ForecastRequest) => call<ForecastRequest, ForecastResponse>("forecastUtilities", req),
  categorize: (req: CategorizeRequest) => call<CategorizeRequest, CategorizeResponse>("categorizeTransactions", req),
  runRecurringNow: () => call<Record<string, never>, RunRecurringResponse>("runRecurringNow", {}),
};
