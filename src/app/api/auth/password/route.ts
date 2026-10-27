import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { forgetUser, requireUser } from "@/lib/auth/server";
import { BCRYPT_ROUNDS, passwordProblem } from "@/lib/auth/admin";
import { rateLimit } from "@/lib/ratelimit";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

/** Change the signed-in user's password. Every other session is signed out; this one stays signed in. */
export const POST = route(async (req) => {
  const user = await requireUser();
  rateLimit(`password:${user.id}`, 5, 15 * 60_000);
  const { currentPassword, newPassword } = await parseBody(req, schema);
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row || !(await bcrypt.compare(currentPassword, row.passwordHash || ""))) throw new ApiError(400, "Current password is incorrect.");
  const problem = passwordProblem(newPassword, row.email);
  if (problem) throw new ApiError(400, problem);
  if (await bcrypt.compare(newPassword, row.passwordHash)) throw new ApiError(400, "The new password must be different from the current one.");

  const sessionVersion = (row.sessionVersion ?? 0) + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), sessionVersion, passwordChangedAt: new Date() },
  });
  forgetUser(user.id);
  (await cookies()).set(SESSION_COOKIE, await signSession({ uid: user.id, role: user.role, sv: sessionVersion }), sessionCookieOptions);
  await audit({ actorId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, ip: clientIp(req) });
  return ok({ ok: true });
});
