/**
 * Shared data model for MeloFlow.
 *
 * Everything in src/lib/shared is plain TypeScript with no Firebase or
 * browser imports, so the same code runs in the Next.js app and is copied
 * into Cloud Functions at build time (functions/scripts/sync-shared.mjs).
 * Dates are stored in Firestore as Timestamps; in this layer they are
 * represented as JavaScript Date objects.
 */

export const CATEGORIES = ["House Bill", "Personal Expense", "Income"] as const;
export type Category = (typeof CATEGORIES)[number];

export const HOUSE_SUBCATEGORIES = ["Rent", "Electric", "Water", "Wifi", "Miscellaneous"] as const;
export type HouseSubCategory = (typeof HOUSE_SUBCATEGORIES)[number];

export const PERSONAL_EXPENSE_SUBCATEGORIES = [
  "Food",
  "Groceries",
  "Transport",
  "Shopping",
  "Phone",
  "Health",
  "Education",
  "Entertainment",
  "Subscriptions",
  "Miscellaneous",
] as const;

export const INCOME_SUBCATEGORIES = ["Salary", "Allowance", "Freelance", "Refund", "Miscellaneous"] as const;

export function subCategoriesFor(category: Category): readonly string[] {
  if (category === "House Bill") return HOUSE_SUBCATEGORIES;
  if (category === "Income") return INCOME_SUBCATEGORIES;
  return PERSONAL_EXPENSE_SUBCATEGORIES;
}

export const PAYMENT_STATUSES = ["Pending", "Partial", "Settled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type Frequency = "Monthly" | "Yearly";

export type SplitMode = "equal" | "ratio" | "fixed";

/** How a shared bill is divided. Keys of the maps are person names. */
export interface SplitConfig {
  mode: SplitMode;
  /** People who share the bill, including the admin (Alia). */
  participants: string[];
  /** ratio mode: percentage per person, should add up to 100. */
  ratios?: Record<string, number>;
  /** fixed mode: fixed RM amount per housemate; the admin pays the remainder. */
  fixedAmounts?: Record<string, number>;
}

export type TransactionSource = "manual" | "ocr" | "import" | "recurring";

export interface Transaction {
  id: string;
  date: Date;
  category: Category;
  subCategory: string;
  vendor: string;
  description?: string;
  totalAmount: number;
  /** kWh for electricity, m³ for water. */
  consumptionUnits?: number | null;
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
  /** Id of the receipt image/PDF in the Firestore `files` collection. */
  receiptFileId?: string | null;
  dueDate?: Date | null;
  isRecurring: boolean;
  frequency?: Frequency | null;
  /** Day of month (1–28) on which the recurring copy is generated. */
  recurrenceDay?: number | null;
  /** Set on generated copies: id of the recurring template. */
  recurringSourceId?: string | null;
  /** Aggregate payment status, kept in sync with the receivables. */
  status: PaymentStatus;
  split?: SplitConfig | null;
  /** Calculated share per person (including the admin) at the time of splitting. */
  shares?: Record<string, number> | null;
  /** Ids of the receivable documents created for this bill. */
  receivableIds?: string[];
  source?: TransactionSource;
  importHash?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PaymentEntry {
  amount: number;
  at: Date;
  note?: string;
}

export interface Receivable {
  id: string;
  transactionId: string;
  debtorName: string;
  /** Share of the bill before running-balance adjustment. */
  baseShare: number;
  /** Running balance applied to this bill (+ adds debt, − uses credit). */
  carryIn: number;
  /** What the housemate owes for this bill: baseShare + carryIn. */
  amountOwed: number;
  amountPaid: number;
  status: PaymentStatus;
  /** Remainder moved to the running balance when the bill was closed early. */
  carriedForward: number;
  /** Overpayment moved to the running balance as credit. */
  creditFromOverpayment: number;
  dueDate?: Date | null;
  payments: PaymentEntry[];
  createdAt?: Date;
  updatedAt: Date;
}

/** Positive runningBalance = housemate owes the admin; negative = credit. */
export interface Balance {
  debtorName: string;
  runningBalance: number;
  updatedAt?: Date;
}

export type BalanceEventReason =
  | "applied-to-bill"
  | "overpayment"
  | "carry-forward"
  | "bill-deleted"
  | "manual-adjustment";

export interface BalanceEvent {
  id: string;
  debtorName: string;
  delta: number;
  balanceAfter: number;
  reason: BalanceEventReason;
  receivableId?: string | null;
  transactionId?: string | null;
  note?: string;
  at: Date;
}

export interface Housemate {
  name: string;
  /** WhatsApp number with country code, digits only, e.g. 60123456789. */
  phone: string;
}

export interface TariffSettings {
  /** Automatic Fuel Adjustment in sen/kWh (changes monthly; can be negative). */
  afaSenPerKwh: number;
  includeEei: boolean;
  includeKwtbb: boolean;
  includeSst: boolean;
}

export interface UserSettings {
  id: string;
  /** The account that first set the app up (any admin account can use it). */
  adminUid: string;
  adminName: string;
  housemates: Housemate[];
  /** Id of the DuitNow QR image in the Firestore `files` collection. */
  duitNowQrFileId?: string | null;
  bankAccountDetails?: string;
  monthlyUtilityCaps: { Electric: number; Water: number };
  /** Personal monthly budget caps by personal expense subcategory. */
  personalBudgetCaps: Record<string, number>;
  /** Overall personal monthly spending cap (0 = no cap). */
  monthlyPersonalBudget: number;
  tariffs: TariffSettings;
  updatedAt?: Date;
}

export type ApplianceType = "Electrical" | "Water";

export interface Appliance {
  id: string;
  name: string;
  type: ApplianceType;
  quantity: number;
  /** Electrical: rated power in watts. */
  powerRatingWatts: number;
  /** Electrical: average hours of use per day. */
  estimatedDailyHours: number;
  /** Electrical: share of time the compressor/heater actually draws full power (air-cons, fridges). */
  dutyCyclePercent: number;
  /** Air conditioners: horsepower, used to estimate wattage when no rating is known. */
  horsepower?: number | null;
  /** Water: m³ used each time (e.g. one washing machine load). */
  waterVolumeCubicMeters: number;
  /** Water: number of uses per week. */
  usesPerWeek: number;
}

export const DEFAULT_TARIFFS: TariffSettings = {
  afaSenPerKwh: 0,
  includeEei: true,
  includeKwtbb: true,
  includeSst: true,
};

export function defaultSettings(adminUid: string): Omit<UserSettings, "id"> {
  return {
    adminUid,
    adminName: "Alia",
    housemates: [
      { name: "Nana", phone: "" },
      { name: "Alisa", phone: "" },
    ],
    duitNowQrFileId: null,
    bankAccountDetails: "",
    monthlyUtilityCaps: { Electric: 0, Water: 0 },
    personalBudgetCaps: {},
    monthlyPersonalBudget: 0,
    tariffs: { ...DEFAULT_TARIFFS },
  };
}
