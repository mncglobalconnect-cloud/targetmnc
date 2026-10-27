import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { zDate, zEmail, zText } from "@/lib/validation";
import { toDbDate } from "@/lib/dates";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: zEmail,
  phone: zText(25),
  designation: zText(80),
  departmentId: z.string().nullable().optional(),
  joinedOn: zDate.nullable().optional(),
  active: z.boolean().optional(),
  account: z
    .object({
      email: z.string().trim().toLowerCase().email().optional(),
      role: z.enum(["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]).optional(),
      password: z.string().min(8).max(100).optional(),
      active: z.boolean().optional(),
    })
    .optional(),
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (body.account) throw new ApiError(400, "Employee logins are disabled while using the single static test account.");
  const before = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
  if (!before) throw new ApiError(404, "Employee not found.");
  if (before.user?.id === user.id && body.active === false) {
    throw new ApiError(400, "You cannot deactivate or demote your own account.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.update({
      where: { id },
      data: {
        name: body.name,
        email: body.email === undefined ? undefined : body.email,
        phone: body.phone === undefined ? undefined : body.phone,
        designation: body.designation === undefined ? undefined : body.designation,
        departmentId: body.departmentId === undefined ? undefined : body.departmentId || null,
        joinedOn: body.joinedOn === undefined ? undefined : body.joinedOn ? toDbDate(body.joinedOn) : null,
        active: body.active,
        updatedById: user.id,
      },
    });
    await audit(
      {
        actorId: user.id,
        action: body.active === false ? "EMPLOYEE_DEACTIVATED" : "EMPLOYEE_UPDATED",
        entityType: "Employee",
        entityId: id,
        before: { ...before, user: before.user ? { email: before.user.email, role: before.user.role, active: before.user.active } : null },
        after: body,
        ip: clientIp(req),
      },
      tx,
    );
    return emp;
  });
  return ok(updated);
});
