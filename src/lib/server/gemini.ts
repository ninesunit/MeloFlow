import "server-only";
import { GoogleGenAI } from "@google/genai";
import { ApiError } from "./errors";

let client: GoogleGenAI | null = null;
let clientKey = "";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
}

function gemini(): GoogleGenAI {
  // Read on every call so a changed key is picked up after a redeploy/restart.
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(503, "AI isn't set up yet: add GEMINI_API_KEY to .env.local (or your Vercel environment variables) and restart.");
  }
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Ask Gemini for JSON matching `schema` and parse it. */
export async function generateJson<T>(opts: {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  let text: string | undefined;
  try {
    const res = await gemini().models.generateContent({
      model: geminiModel(),
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
    if (e instanceof ApiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Gemini request failed:", msg);
    if (/API key|permission|403|401/i.test(msg)) throw new ApiError(503, "Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (/not found|404/i.test(msg)) throw new ApiError(503, `Gemini model "${geminiModel()}" was not found. Set GEMINI_MODEL to a current model.`);
    if (/quota|429|exhausted/i.test(msg)) throw new ApiError(429, "Gemini's free quota is used up for now. Try again later.");
    throw new ApiError(502, "Gemini could not be reached. Try again in a moment.");
  }
  if (!text) throw new ApiError(502, "Gemini returned an empty response.");
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Gemini returned invalid JSON:", text.slice(0, 500));
    throw new ApiError(502, "Gemini returned an unreadable response. Try again.");
  }
}
