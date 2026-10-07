import "server-only";
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
} from "../shared/ai-types";
import { HOUSE_SUBCATEGORIES, INCOME_SUBCATEGORIES, PERSONAL_EXPENSE_SUBCATEGORIES } from "../shared/types";
import { ApiError } from "./errors";
import { generateJson } from "./gemini";

/**
 * The Gemini-powered actions behind /api/gemini. Each takes already-parsed
 * input and returns JSON for the browser. They run only on the server.
 */

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
/** Vercel caps a request body at about 4.5 MB, so uploads must stay under 4 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const nullable = (type: string) => ({ type: [type, "null"] });

// ---------------- Receipt / bill OCR ----------------

export async function parseBill(file: { mimeType: string; base64: string }): Promise<ParsedBill> {
  if (!ALLOWED_MIME.includes(file.mimeType)) {
    throw new ApiError(400, "Upload a JPG, PNG, WEBP, HEIC image or a PDF.");
  }
  return generateJson<ParsedBill>({
    system: [
      "You read Malaysian bills and receipts and extract structured data.",
      "Common vendors: TNB / Tenaga Nasional (electricity, kWh), Air Selangor / SYABAS / Indah Water (water, m³), Unifi / TIME / Maxis / CelcomDigi (internet = Wifi), landlords (Rent).",
      "Amounts are in Malaysian ringgit (RM). Return the TOTAL AMOUNT DUE for this bill (Jumlah Perlu Dibayar / Amount Due), not a single line item.",
      "If the bill shows an amount carried from earlier unpaid bills, still return the total amount due as printed.",
      "Dates must be YYYY-MM-DD. Malaysian documents usually write dates as DD/MM/YYYY.",
      `For utility bills use category "House Bill" and subCategory one of: ${HOUSE_SUBCATEGORIES.join(", ")}.`,
      `For a shop or restaurant receipt use "Personal Expense" with subCategory one of: ${PERSONAL_EXPENSE_SUBCATEGORIES.join(", ")}.`,
      "consumptionUnits: total kWh for electricity or total m³ for water for this billing period; null for other bills.",
      "Use null for anything you cannot read with confidence. Never guess numbers.",
      "accountNumberLast4: only the last 4 digits of the account number if shown, otherwise null.",
    ].join("\n"),
    parts: [
      { inlineData: { mimeType: file.mimeType, data: file.base64 } },
      { text: "Extract the bill details from this document." },
    ],
    schema: {
      type: "object",
      properties: {
        vendor: nullable("string"),
        category: { type: ["string", "null"], enum: ["House Bill", "Personal Expense", "Income", null] },
        subCategory: nullable("string"),
        totalAmount: nullable("number"),
        billDate: nullable("string"),
        dueDate: nullable("string"),
        billingPeriodStart: nullable("string"),
        billingPeriodEnd: nullable("string"),
        consumptionUnits: nullable("number"),
        consumptionUnit: { type: ["string", "null"], enum: ["kWh", "m3", null] },
        accountNumberLast4: nullable("string"),
        notes: { type: ["string", "null"], description: "Anything unusual, e.g. arrears included or a partially unreadable total" },
      },
      required: [
        "vendor",
        "category",
        "subCategory",
        "totalAmount",
        "billDate",
        "dueDate",
        "billingPeriodStart",
        "billingPeriodEnd",
        "consumptionUnits",
        "consumptionUnit",
        "accountNumberLast4",
        "notes",
      ],
    },
    temperature: 0,
  });
}

// ---------------- WhatsApp message polish ----------------

export async function composeMessage(data: ComposeMessageRequest): Promise<ComposeMessageResponse> {
  const { draft, tone, language } = data ?? ({} as ComposeMessageRequest);
  if (!draft || typeof draft !== "string" || draft.length > 4000) throw new ApiError(400, "The draft message is missing or too long.");
  return generateJson<ComposeMessageResponse>({
    system: [
      "You rewrite house-bill reminders that a Malaysian student sends to her housemates on WhatsApp.",
      "Keep EVERY number, amount, date, name, link and bank detail exactly as in the draft — do not recalculate, round or drop any of them.",
      "Keep the WhatsApp formatting (*bold*) for the amount to pay. Keep links on their own lines so they stay tappable.",
      "Be warm and clear, never guilt-tripping. Use at most two emoji.",
      `Tone: ${tone || "friendly"}. Language: ${language === "Malay" ? "Bahasa Melayu" : language === "Mixed" ? "casual Malaysian English mixed with a little Malay" : "English"}.`,
    ].join("\n"),
    parts: [{ text: draft }],
    schema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    temperature: 0.6,
  });
}

// ---------------- Consumption spike explanation ----------------

export async function analyzeUtilities(d: AnalyzeUtilitiesRequest): Promise<AnalyzeUtilitiesResponse> {
  if (!d?.kind || !d.current) throw new ApiError(400, "Missing bill data.");
  return generateJson<AnalyzeUtilitiesResponse>({
    system: [
      "You help a household in Selangor, Malaysia understand changes in their utility bills.",
      "Electricity is billed by TNB (tiered: cheaper up to 1,500 kWh; an energy-efficiency rebate shrinks as usage rises past 200 kWh and ends above 1,000 kWh; retail charge RM10 above 600 kWh; a monthly fuel adjustment (AFA) can move the price).",
      "Water is billed by Air Selangor in blocks (RM0.65/m³ up to 20 m³, RM1.62 for 20–35 m³, RM3.51 above 35 m³), so cost grows faster than usage.",
      "Use only the numbers given. Mention when cost rose more than usage (tariff block or rate effects) versus usage itself rising.",
      "Consider Malaysian context: hot season / heatwaves driving air-con use, school holidays and semester breaks, guests, festive seasons, leaks, longer billing periods.",
      "Severity: 'normal' if within 20%, 'watch' for 20–40%, 'high' above 40% or likely a leak/fault.",
      "Keep summary to 2–3 sentences. Give 2–4 likely causes and 2–4 practical suggestions.",
    ].join("\n"),
    parts: [{ text: JSON.stringify(d) }],
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        likelyCauses: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
        severity: { type: "string", enum: ["normal", "watch", "high"] },
      },
      required: ["summary", "likelyCauses", "suggestions", "severity"],
    },
  });
}

// ---------------- Forecasting ----------------

export async function forecastUtilities(d: ForecastRequest): Promise<ForecastResponse> {
  if (!d?.kind || !Array.isArray(d.history) || d.history.length === 0) {
    throw new ApiError(400, "Add at least one past bill to forecast from.");
  }
  return generateJson<ForecastResponse>({
    system: [
      "You forecast next month's household utility bill in Selangor, Malaysia from past monthly bills.",
      "Account for trend and seasonality: Malaysia is hottest around March–May (more air-con), the northeast monsoon is roughly November–March, and student households often use less during semester breaks.",
      "A statistical baseline is provided; start from it and adjust only when the history clearly supports it.",
      "Return amount in RM, units in kWh (Electric) or m³ (Water) or null if no unit history, and a low–high range.",
      "reasoning: 2–3 plain sentences a student can understand.",
    ].join("\n"),
    parts: [{ text: JSON.stringify(d) }],
    schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        units: { type: ["number", "null"] },
        low: { type: "number" },
        high: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["amount", "units", "low", "high", "reasoning"],
    },
  });
}

// ---------------- Bank statement categorisation ----------------

export async function categorizeTransactions(data: CategorizeRequest): Promise<CategorizeResponse> {
  const items = data?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) return { results: [] };
  if (items.length > 300) throw new ApiError(400, "Send at most 300 lines at a time.");
  const res = await generateJson<CategorizeResponse>({
    system: [
      "Categorise Malaysian bank statement lines for a university student's budget.",
      "Negative amounts are money out, positive amounts are money in.",
      "Money in → category 'Income' with subCategory one of: " + INCOME_SUBCATEGORIES.join(", ") + ".",
      "Utility, internet and rent payments for the shared house → 'House Bill' with subCategory one of: " + HOUSE_SUBCATEGORIES.join(", ") + ".",
      "Everything else money out → 'Personal Expense' with subCategory one of: " + PERSONAL_EXPENSE_SUBCATEGORIES.join(", ") + ".",
      "Hints: JomPAY/TNB = Electric, Air Selangor/SYABAS = Water, Unifi/TIME = Wifi, GrabFood/foodpanda = Food, Grab/TNG/Petronas = Transport, Shopee/Lazada = Shopping.",
      "Return one result per input index.",
    ].join("\n"),
    parts: [{ text: JSON.stringify(items.map((i) => ({ index: i.index, description: String(i.description).slice(0, 200), amount: i.amount }))) }],
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              category: { type: "string", enum: ["House Bill", "Personal Expense", "Income"] },
              subCategory: { type: "string" },
            },
            required: ["index", "category", "subCategory"],
          },
        },
      },
      required: ["results"],
    },
    temperature: 0,
  });
  // Keep only valid subcategories.
  const valid: Record<string, readonly string[]> = {
    "House Bill": HOUSE_SUBCATEGORIES,
    "Personal Expense": PERSONAL_EXPENSE_SUBCATEGORIES,
    Income: INCOME_SUBCATEGORIES,
  };
  return {
    results: (res.results ?? []).map((r) => ({
      ...r,
      subCategory: valid[r.category]?.includes(r.subCategory) ? r.subCategory : "Miscellaneous",
    })),
  };
}
