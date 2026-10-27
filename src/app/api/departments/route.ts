import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { audit } from "@/lib/audit";

export const GET = route(async () => {
  await requireUser();
  return ok(await prisma.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true, teams: true } } } }));
});

export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(2).max(80) }));
  const dept = await prisma.department.create({ data: { name } });
  await audit({ actorId: user.id, action: "DEPARTMENT_CREATED", entityType: "Department", entityId: dept.id, after: dept, ip: clientIp(req) });
  return ok(dept, { status: 201 });
});
