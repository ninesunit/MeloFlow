/**
 * Plain-text bill notices for WhatsApp. These templates are always available;
 * the Gemini "polish" step rewrites them but is given these exact numbers.
 */
import { formatDate, mytParts } from "./dates";
import { formatRM, isZero, round2 } from "./money";
import type { Receivable, Transaction, UserSettings } from "./types";

/** Shareable links to include, built by the app from stored file ids. */
export interface NoticeLinks {
  receiptUrl?: string | null;
  qrUrl?: string | null;
}

export interface BillNoticeInput {
  settings: Pick<UserSettings, "adminName" | "bankAccountDetails">;
  debtorName: string;
  transaction: Pick<
    Transaction,
    "vendor" | "subCategory" | "totalAmount" | "date" | "dueDate" | "shares" | "split" | "consumptionUnits" | "billingPeriodStart" | "billingPeriodEnd"
  >;
  receivable: Pick<Receivable, "baseShare" | "carryIn" | "amountOwed" | "amountPaid" | "dueDate">;
  links?: NoticeLinks;
}

function periodLabel(t: BillNoticeInput["transaction"]): string {
  if (t.billingPeriodStart && t.billingPeriodEnd) {
    return `${formatDate(t.billingPeriodStart)} – ${formatDate(t.billingPeriodEnd)}`;
  }
  const { year, month } = mytParts(t.date);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]} ${year}`;
}

function splitLabel(t: BillNoticeInput["transaction"]): string {
  const mode = t.split?.mode;
  if (mode === "equal") return "split equally";
  if (mode === "ratio") return "split by percentage";
  if (mode === "fixed") return "fixed amounts";
  return "split";
}

function paymentLines(settings: BillNoticeInput["settings"], qrUrl?: string | null): string[] {
  const lines: string[] = [];
  if (settings.bankAccountDetails?.trim()) {
    lines.push("", "*Pay to:*", settings.bankAccountDetails.trim());
  }
  if (qrUrl) {
    lines.push("", `DuitNow QR: ${qrUrl}`);
  }
  return lines;
}

export function buildBillNotice({ settings, debtorName, transaction: t, receivable: r, links = {} }: BillNoticeInput): string {
  const unit = t.subCategory === "Electric" ? "kWh" : t.subCategory === "Water" ? "m³" : "";
  const lines: string[] = [];
  lines.push(`Hi ${debtorName}! Here's the *${t.subCategory}* bill (${t.vendor}) for ${periodLabel(t)}.`);
  lines.push("");
  lines.push(`Total bill: ${formatRM(t.totalAmount)}${t.consumptionUnits && unit ? ` (${t.consumptionUnits} ${unit})` : ""}`);
  if (t.shares) {
    const parts = Object.entries(t.shares).map(([name, amt]) => `${name} ${formatRM(amt)}`);
    lines.push(`Breakdown (${splitLabel(t)}): ${parts.join(" · ")}`);
  }
  lines.push(`Your share: ${formatRM(r.baseShare)}`);
  if (!isZero(r.carryIn)) {
    lines.push(
      r.carryIn > 0
        ? `Unpaid from previous bills: +${formatRM(r.carryIn)}`
        : `Credit from previous overpayment: −${formatRM(Math.abs(r.carryIn))}`,
    );
  }
  if (r.amountPaid > 0) lines.push(`Already paid: ${formatRM(r.amountPaid)}`);
  const due = round2(r.amountOwed - r.amountPaid);
  lines.push("");
  lines.push(`*Amount to pay: ${formatRM(Math.max(0, due))}*`);
  const dueDate = r.dueDate ?? t.dueDate;
  if (dueDate) lines.push(`Due by: ${formatDate(dueDate)}`);
  if (links.receiptUrl) lines.push("", `Receipt: ${links.receiptUrl}`);
  lines.push(...paymentLines(settings, links.qrUrl));
  lines.push("", `Thank you! — ${settings.adminName}`);
  return lines.join("\n");
}

export interface SummaryItem {
  label: string;
  dueDate?: Date | null;
  outstanding: number;
}

/** One message listing everything a housemate still owes. */
export function buildOutstandingSummary(
  settings: BillNoticeInput["settings"],
  debtorName: string,
  items: SummaryItem[],
  runningBalance: number,
  links: NoticeLinks = {},
): string {
  const lines: string[] = [`Hi ${debtorName}! Here's a summary of house bills still outstanding:`, ""];
  let total = 0;
  for (const item of items) {
    total += item.outstanding;
    lines.push(`• ${item.label}: ${formatRM(item.outstanding)}${item.dueDate ? ` (due ${formatDate(item.dueDate)})` : ""}`);
  }
  if (!isZero(runningBalance)) {
    lines.push(
      runningBalance > 0
        ? `• Carried over (will be added to your next bill): ${formatRM(runningBalance)}`
        : `• Credit (will be taken off your next bill): −${formatRM(Math.abs(runningBalance))}`,
    );
  }
  lines.push("", `*Total outstanding now: ${formatRM(round2(total))}*`);
  lines.push(...paymentLines(settings, links.qrUrl));
  lines.push("", `Thank you! — ${settings.adminName}`);
  return lines.join("\n");
}

/** Digits only, converting a local 01x number to 601x. */
export function normalisePhone(phone: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `6${digits}`;
  return digits;
}

/** https://wa.me link that opens WhatsApp with the message filled in. */
export function whatsappLink(phone: string, text: string): string {
  const number = normalisePhone(phone);
  const base = number ? `https://wa.me/${number}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}
