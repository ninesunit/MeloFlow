import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/** Singapore is the closest Cloud Functions region to Malaysia. */
export const REGION = "asia-southeast1";
export const TIME_ZONE = "Asia/Kuala_Lumpur";

/** Set with: firebase functions:secrets:set GEMINI_API_KEY */
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const ADMIN_EMAIL = defineString("ADMIN_EMAIL", {
  description: "Email of the single administrator account allowed to use MeloFlow",
});
export const GEMINI_MODEL = defineString("GEMINI_MODEL", {
  default: "gemini-3.8-flash",
  description: "Gemini model ID used by the AI features",
});

/** Reject any caller who is not the signed-in administrator. */
export function requireAdmin(request: CallableRequest<unknown>): void {
  const email = request.auth?.token?.email?.toLowerCase();
  if (!request.auth || !email) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  if (email !== ADMIN_EMAIL.value().trim().toLowerCase()) {
    throw new HttpsError("permission-denied", "Only the administrator account can use this.");
  }
}
