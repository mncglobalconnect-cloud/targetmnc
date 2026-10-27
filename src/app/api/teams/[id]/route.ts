import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { audit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  departmentId: z.string().nullable().optional(),
  leaderId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  const before = await prisma.team.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "Team not found.");
  const team = await prisma.team.update({
    where: { id },
    data: {
      name: body.name,
      departmentId: body.departmentId === undefined ? undefined : body.departmentId || null,
      leaderId: body.leaderId === undefined ? undefined : body.leaderId || null,
      active: body.active,
      // Archive instead of delete so historical reports remain intact.
      archivedAt: body.archived === undefined ? undefined : body.archived ? new Date() : null,
    },
  });
  await audit({ actorId: user.id, action: body.archived ? "TEAM_ARCHIVED" : "TEAM_UPDATED", entityType: "Team", entityId: id, before, after: team, ip: clientIp(req) });
  return ok(team);
});
