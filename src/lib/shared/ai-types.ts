/** Request/response shapes for the Gemini-backed Cloud Functions. */

export interface ParseBillRequest {
  /** Path of the uploaded file in Firebase Storage (receipts/...). */
  storagePath: string;
  mimeType: string;
}

export interface ParsedBill {
  vendor: string | null;
  category: "House Bill" | "Personal Expense" | "Income" | null;
  subCategory: string | null;
  totalAmount: number | null;
  billDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  consumptionUnits: number | null;
  consumptionUnit: "kWh" | "m3" | null;
  accountNumberLast4: string | null;
  notes: string | null;
}

export interface ComposeMessageRequest {
  /** The template message with all the correct numbers in it. */
  draft: string;
  tone: "friendly" | "formal" | "short";
  language: "English" | "Malay" | "Mixed";
}

export interface ComposeMessageResponse {
  message: string;
}

export interface UtilityPoint {
  month: string; // YYYY-MM
  amount: number;
  units: number | null;
}

export interface AnalyzeUtilitiesRequest {
  kind: "Electric" | "Water";
  current: UtilityPoint;
  history: UtilityPoint[];
  averageAmount: number;
  averageUnits: number | null;
  costChangePercent: number;
  unitsChangePercent: number | null;
}

export interface AnalyzeUtilitiesResponse {
  summary: string;
  likelyCauses: string[];
  suggestions: string[];
  severity: "normal" | "watch" | "high";
}

export interface ForecastRequest {
  kind: "Electric" | "Water";
  targetMonth: string;
  history: UtilityPoint[];
  baseline: { amount: number; units: number | null; low: number; high: number };
}

export interface ForecastResponse {
  amount: number;
  units: number | null;
  low: number;
  high: number;
  reasoning: string;
}

export interface CategorizeRequest {
  items: { index: number; description: string; amount: number }[];
}

export interface CategorizeResponse {
  results: { index: number; category: "House Bill" | "Personal Expense" | "Income"; subCategory: string }[];
}

export interface RunRecurringResponse {
  created: number;
  skipped: number;
  details: string[];
}
