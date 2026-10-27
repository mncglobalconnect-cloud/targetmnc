import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedEmployeeIds } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { zDate, zEmail, zPage, zText } from "@/lib/validation";
import { toDbDate, todayInTz } from "@/lib/dates";

const listSchema = zPage.extend({
  q: z.string().trim().max(100).optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, listSchema);
  const scope = await scopedEmployeeIds(user);
  const canSeeContacts = user.role !== "EMPLOYEE";

  const where: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    ...(scope === "ALL" ? {} : { id: { in: scope } }),
    ...(q.active === "all" ? {} : { active: q.active === "true" }),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.teamId ? { memberships: { some: { teamId: q.teamId, endDate: null } } } : {}),
    ...(q.q
      ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { code: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      include: {
        department: true,
        user: { select: { id: true, email: true, role: true, active: true, lastLoginAt: true } },
        memberships: { where: { endDate: null }, include: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { name: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return ok({
    total,
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      designation: e.designation,
      email: canSeeContacts || e.id === user.employeeId ? e.email : null,
      phone: canSeeContacts || e.id === user.employeeId ? e.phone : null,
      department: e.department ? { id: e.department.id, name: e.department.name } : null,
      teams: e.memberships.map((m) => m.team),
      active: e.active,
      joinedOn: e.joinedOn?.toISOString().slice(0, 10) ?? null,
      user: user.role === "SUPER_ADMIN" ? e.user : e.user ? { role: e.user.role } : null,
    })),
  });
});

const createSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  email: zEmail,
  phone: zText(25),
  designation: zText(80),
  departmentId: z.string().nullable().optional(),
  joinedOn: zDate.nullable().optional(),
  teamId: z.string().nullable().optional(),
  account: z
    .object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8, "Password must be at least 8 characters").max(100),
      role: z.enum(["SUPER_ADMIN", "MANAGER", "EMPLOYEE"]),
    })
    .nullable()
    .optional(),
});

export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const body = await parseBody(req, createSchema);
  if (body.account) throw new ApiError(400, "Employee logins are disabled while using the single static test account.");
  if (await prisma.employee.findUnique({ where: { code: body.code } })) throw new ApiError(409, `Employee code ${body.code} is already in use.`);

  const created = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: {
        code: body.code,
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        designation: body.designation ?? null,
        departmentId: body.departmentId || null,
        joinedOn: body.joinedOn ? toDbDate(body.joinedOn) : null,
        createdById: user.id,
      },
    });
    if (body.teamId) {
      await tx.teamMembership.create({
        data: { teamId: body.teamId, employeeId: emp.id, startDate: toDbDate(body.joinedOn ?? todayInTz()), createdById: user.id },
      });
    }
    await audit({ actorId: user.id, action: "EMPLOYEE_CREATED", entityType: "Employee", entityId: emp.id, after: emp, ip: clientIp(req) }, tx);
    return emp;
  });
  return ok(created, { status: 201 });
});
