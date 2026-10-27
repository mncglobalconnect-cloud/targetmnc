import { prisma } from "@/lib/db";
import { clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { settingsSchema } from "@/lib/settings-schema";
import { audit } from "@/lib/audit";

export const GET = route(async () => {
  await requireUser(["SUPER_ADMIN", "MANAGER"]);
  const [settings, categories] = await Promise.all([getSettings(), prisma.achievementCategory.findMany({ orderBy: { sortOrder: "asc" } })]);
  return ok({ settings, categories });
});

export const PUT = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const body = await parseBody(req, settingsSchema);
  const before = await getSettings();
  const saved = await saveSettings(body, user.id);
  await audit({ actorId: user.id, action: "SETTINGS_UPDATED", entityType: "AppSetting", entityId: "app", before, after: saved, ip: clientIp(req) });
  return ok(saved);
});
