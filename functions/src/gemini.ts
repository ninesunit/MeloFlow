import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { GEMINI_API_KEY, GEMINI_MODEL } from "./config";

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "The Gemini API key is not set. Run: firebase functions:secrets:set GEMINI_API_KEY",
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Ask Gemini for JSON that matches `schema` and parse it.
 * Errors from the API are logged and returned to the app as a readable message.
 */
export async function generateJson<T>(opts: {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  let text: string | undefined;
  try {
    const res = await gemini().models.generateContent({
      model: GEMINI_MODEL.value(),
      contents: [{ role: "user", parts: opts.parts }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
        temperature: opts.temperature ?? 0.2,
      },
    });
    text = res.text;
  } catch (e) {
    logger.error("Gemini request failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/API key|permission|403|401/i.test(msg)) {
      throw new HttpsError("failed-precondition", "Gemini rejected the API key. Check the GEMINI_API_KEY secret.");
    }
    if (/not found|404/i.test(msg)) {
      throw new HttpsError("failed-precondition", `Gemini model "${GEMINI_MODEL.value()}" was not found. Set GEMINI_MODEL in functions/.env.`);
    }
    if (/quota|429|exhausted/i.test(msg)) {
      throw new HttpsError("resource-exhausted", "Gemini quota reached. Try again later.");
    }
    throw new HttpsError("unavailable", "Gemini could not be reached. Try again in a moment.");
  }
  if (!text) throw new HttpsError("internal", "Gemini returned an empty response.");
  try {
    return JSON.parse(text) as T;
  } catch {
    logger.error("Gemini returned invalid JSON", { text });
    throw new HttpsError("internal", "Gemini returned an unreadable response. Try again.");
  }
}
