/**
 * POST /api/gemini — every AI feature goes through here, so GEMINI_API_KEY
 * stays on the server. Callers must send the admin's Firebase ID token:
 *   Authorization: Bearer <idToken>
 *
 * JSON body:  { "action": "composeMessage" | "analyzeUtilities" | "forecastUtilities" | "categorize", "data": {...} }
 * Form data:  action=parseBill, file=<image or PDF>   (bill / receipt reading)
 */
import { analyzeUtilities, categorizeTransactions, composeMessage, forecastUtilities, MAX_UPLOAD_BYTES, parseBill } from "@/lib/server/ai-actions";
import { requireAdmin } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JSON_ACTIONS = {
  composeMessage,
  analyzeUtilities,
  forecastUtilities,
  categorize: categorizeTransactions,
} as const;

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      if (form.get("action") !== "parseBill") throw new ApiError(400, "Unknown action.");
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Attach the bill to read.");
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "The file is larger than 4 MB. Take a smaller photo or compress the PDF.");
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      return Response.json(await parseBill({ mimeType: file.type || "application/octet-stream", base64 }));
    }

    const body = (await request.json().catch(() => null)) as { action?: string; data?: unknown } | null;
    const action = body?.action as keyof typeof JSON_ACTIONS | undefined;
    if (!action || !(action in JSON_ACTIONS)) throw new ApiError(400, "Unknown action.");
    // Each action validates its own input.
    const handler = JSON_ACTIONS[action] as (data: unknown) => Promise<unknown>;
    return Response.json(await handler(body?.data));
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error("/api/gemini failed:", e);
    return Response.json({ error: "Something went wrong on the server. Try again." }, { status: 500 });
  }
}
