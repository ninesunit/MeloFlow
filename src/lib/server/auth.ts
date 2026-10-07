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

export async function requireAdmin(request: Request): Promise<{ uid: string; email: string }> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!projectId || !adminEmail) {
    throw new ApiError(500, "The server is missing NEXT_PUBLIC_FIREBASE_PROJECT_ID or ADMIN_EMAIL. Add them to .env.local (or your Vercel project settings).");
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

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!payload.sub || email !== adminEmail) {
    throw new ApiError(403, "Only the administrator account can use this.");
  }
  return { uid: payload.sub, email };
}
