import { z } from "zod";

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const settingsSchema = z.object({
  timezone: z.string().min(1).default("Asia/Kolkata"),
  workdayStart: hm.default("09:30"),
  workdayEnd: hm.default("18:30"),
  weekendDays: z.array(z.number().int().min(0).max(6)).default([0]),
  holidays: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1).max(100) }))
    .default([]),
  status: z
    .object({
      /** Allowed shortfall vs. the time-proportional expectation before an employee is "At Risk". */
      onTrackTolerancePct: z.number().min(0).max(100).default(15),
      /** No one is flagged At Risk during the first N minutes of the business day. */
      graceMinutes: z.number().int().min(0).max(720).default(120),
    })
    .default({}),
  leads: z
    .object({
      /** ORIGINAL_CREATOR: the employee who created the lead keeps the target credit after transfers. */
      attributionPolicy: z.enum(["ORIGINAL_CREATOR"]).default("ORIGINAL_CREATOR"),
      /** When true, saving an exact duplicate (same normalized phone or email) is rejected instead of warned. */
      blockExactDuplicates: z.boolean().default(false),
    })
    .default({}),
  permissions: z
    .object({
      employeesCanRecordAchievements: z.boolean().default(true),
      employeesCanEditOwnSameDay: z.boolean().default(true),
      managersCanAssignTargets: z.boolean().default(true),
      /** Max daily monetary target a manager may assign to one employee (null = no limit). */
      managerMaxDailyTarget: z.number().nonnegative().nullable().default(null),
    })
    .default({}),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({});
