/**
 * MeloFlow Cloud Functions
 *  - parseBill, composeMessage, analyzeUtilities, forecastUtilities,
 *    categorizeTransactions: Gemini-powered callables (the API key never
 *    reaches the browser)
 *  - generateRecurringBills: daily schedule that creates recurring bills
 *    and carries running balances into them
 *  - runRecurringNow: run that generator on demand
 */
import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { REGION } from "./config";

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 5 });

export { analyzeUtilities, categorizeTransactions, composeMessage, forecastUtilities, parseBill } from "./ai";
export { generateRecurringBills, runRecurringNow } from "./recurring";
