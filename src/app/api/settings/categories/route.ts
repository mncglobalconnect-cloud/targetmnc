import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { audit } from "@/lib/audit";

const schema = z.object({
  id: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, "Use letters, digits and underscores"),
  name: z.string().trim().min(2).max(80),
  countsTowardTarget: z.boolean(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/**
 * Create/update an achievement category. Changing countsTowardTarget affects only entries saved afterwards —
 * existing entries keep the rule frozen at their save time, so historical reports stay stable.
 */
export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const body = await parseBody(req, schema);
  const before = body.id ? await prisma.achievementCategory.findUnique({ where: { id: body.id } }) : null;
  if (body.id && !before) throw new ApiError(404, "Category not found.");
  const { id, ...data } = body;
  const saved = id ? await prisma.achievementCategory.update({ where: { id }, data }) : await prisma.achievementCategory.create({ data });
  await audit({ actorId: user.id, action: id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED", entityType: "AchievementCategory", entityId: saved.id, before, after: saved, ip: clientIp(req) });
  return ok(saved);
});
