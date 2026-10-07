import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "./errors";

/**
 * Firebase Auth ID tokens are JWTs signed by Google. Checking them only needs
 * the project ID and Google's public keys — no service account, no Admin SDK,
 * so this works on the Spark plan.
 */
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/**
 * Optional fast path: admin emails from ADMIN_EMAILS (comma-separated; the
 * older single ADMIN_EMAIL also works). The Firestore security rules are the
 * real admin list — see firestoreAllows() — so this env var can lag behind
 * without locking anyone out.
 */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
}

/** Accounts recently confirmed by Firestore, so each AI call doesn't repeat the check. */
const confirmed = new Map<string, number>();
const CONFIRM_TTL_MS = 10 * 60 * 1000;

/**
 * Ask Firestore whether this signed-in user may read the settings document.
 * The request carries the user's own ID token, so Firestore applies the
 * security rules exactly as it does for the browser: only accounts the rules
 * list as admins get 200 (or 404 if the document doesn't exist yet).
 */
async function firestoreAllows(projectId: string, idToken: string): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/userSettings/main?mask.fieldPaths=adminName`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" });
    return res.status === 200 || res.status === 404;
  } catch (e) {
    console.error("Firestore admin check failed:", e);
    throw new ApiError(503, "Couldn't check your account with Firebase. Try again in a moment.");
  }
}

export async function requireAdmin(request: Request): Promise<{ uid: string; email: string }> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new ApiError(500, "The server is missing NEXT_PUBLIC_FIREBASE_PROJECT_ID. Add it to .env.local (or your Vercel project settings).");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError(401, "Sign in first.");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new ApiError(401, "Your sign-in has expired. Refresh the page and try again.");
  }

  const uid = payload.sub;
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!uid) throw new ApiError(401, "Your sign-in has expired. Refresh the page and try again.");

  if (email && adminEmails().includes(email)) return { uid, email };

  const until = confirmed.get(uid);
  if (until && until > Date.now()) return { uid, email };

  if (await firestoreAllows(projectId, token)) {
    confirmed.set(uid, Date.now() + CONFIRM_TTL_MS);
    return { uid, email };
  }
  throw new ApiError(403, `${email || "This account"} isn't on the admin list in the Firestore rules, so it can't use the AI features.`);
}
