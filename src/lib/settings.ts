import { prisma } from "./db";
import { settingsSchema, type AppSettings } from "./settings-schema";
import { weekday } from "./dates";

const KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return settingsSchema.parse(row?.value ?? { timezone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata" });
}

export async function saveSettings(value: unknown, userId: string): Promise<AppSettings> {
  const parsed = settingsSchema.parse(value);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: parsed, updatedById: userId },
    update: { value: parsed, updatedById: userId },
  });
  return parsed;
}

export function isWorkingDay(date: string, s: AppSettings): { working: boolean; reason?: string } {
  const h = s.holidays.find((x) => x.date === date);
  if (h) return { working: false, reason: `Holiday: ${h.name}` };
  if (s.weekendDays.includes(weekday(date))) return { working: false, reason: "Weekend" };
  return { working: true };
}
