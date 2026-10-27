// Edge-safe session token helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "tms_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type RoleName = "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";

export interface SessionPayload {
  uid: string;
  role: RoleName;
  /** User's sessionVersion when the token was issued; a password change invalidates older tokens. */
  sv: number;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.uid !== "string" || typeof payload.role !== "string") return null;
    return { uid: payload.uid, role: payload.role as RoleName, sv: typeof payload.sv === "number" ? payload.sv : 0 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
