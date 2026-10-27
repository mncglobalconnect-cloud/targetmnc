import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getMongoConnection } from "@/lib/mongo-store";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { rateLimit, resetRateLimit } from "@/lib/ratelimit";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

// Compared when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

/** Signs in against the account stored in MongoDB (bcrypt password hash). */
export const POST = route(async (req) => {
  const ip = clientIp(req);
  rateLimit(`login-ip:${ip}`, 20, 15 * 60_000);
  const { email, password } = await parseBody(req, schema);
  rateLimit(`login:${email}`, 5, 5 * 60_000);

  await getMongoConnection(); // first connection creates the admin account if it does not exist yet
  const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });
  const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !user.passwordHash) {
    if (user && !user.passwordHash) throw new ApiError(503, "The admin password has not been set up yet. Set ADMIN_INITIAL_PASSWORD in .env and restart the application.");
    throw new ApiError(401, "Invalid email or password.");
  }
  if (!valid) {
    await audit({ actorId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id, ip });
    throw new ApiError(401, "Invalid email or password.");
  }
  if (!user.active || (user.employee && !user.employee.active)) throw new ApiError(403, "This account has been deactivated.");

  resetRateLimit(`login:${email}`);
  const token = await signSession({ uid: user.id, role: user.role, sv: user.sessionVersion ?? 0 });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, ip });
  return ok({ ok: true, role: user.role });
});
