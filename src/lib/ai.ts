"use client";

import { auth } from "./firebase";
import type {
  AnalyzeUtilitiesRequest,
  AnalyzeUtilitiesResponse,
  CategorizeRequest,
  CategorizeResponse,
  ComposeMessageRequest,
  ComposeMessageResponse,
  ForecastRequest,
  ForecastResponse,
  ParsedBill,
} from "./shared/ai-types";

/** Calls /api/gemini with the signed-in admin's ID token. */
async function post<Res>(body: BodyInit, json: boolean): Promise<Res> {
  const user = auth().currentUser;
  if (!user) throw new Error("Sign in first.");
  const token = await user.getIdToken();
  let res: Response;
  try {
    // Trailing slash matches trailingSlash: true in next.config, avoiding a redirect.
    res = await fetch("/api/gemini/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
      body,
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const payload = (await res.json().catch(() => null)) as (Res & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 404) throw new Error("The AI route isn't available. Run the app with `npm run dev` or deploy it to Vercel — a static export has no server.");
    throw new Error(payload?.error || `The AI request failed (${res.status}).`);
  }
  if (!payload) throw new Error("The server sent back an empty response.");
  return payload;
}

const action = <Req, Res>(name: string) => (data: Req) => post<Res>(JSON.stringify({ action: name, data }), true);

export const ai = {
  /** Read a bill or receipt (image or PDF, under 4 MB). */
  parseBill: (file: Blob, fileName = "bill") => {
    const form = new FormData();
    form.set("action", "parseBill");
    form.set("file", file, fileName);
    return post<ParsedBill>(form, false);
  },
  composeMessage: action<ComposeMessageRequest, ComposeMessageResponse>("composeMessage"),
  analyzeUtilities: action<AnalyzeUtilitiesRequest, AnalyzeUtilitiesResponse>("analyzeUtilities"),
  forecastUtilities: action<ForecastRequest, ForecastResponse>("forecastUtilities"),
  categorize: action<CategorizeRequest, CategorizeResponse>("categorize"),
};
