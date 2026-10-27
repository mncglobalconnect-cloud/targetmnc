import { z } from "zod";
import { isIsoDate } from "./dates";

export const zDate = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD)");

/** Money as string/number → validated 2dp string (kept as a string to avoid float rounding). */
export const zMoney = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.replace(/[₹,\s]/g, "")))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a non-negative amount with up to 2 decimals")
  .transform((v) => Number(v).toFixed(2));

export const zPositiveMoney = zMoney.refine((v) => Number(v) > 0, "Amount must be greater than zero");

export const zCount = z.coerce.number().int("Must be a whole number").min(0, "Cannot be negative").max(100000);

export const zId = z.string().min(1).max(64);

export const zText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const zReason = z.string().trim().min(5, "Reason must be at least 5 characters").max(500).optional().nullable();

export const zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const zPhone = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(25)
  .refine((v) => /^[+()\-\s\d]+$/.test(v) && v.replace(/\D/g, "").length >= 7, "Enter a valid phone number");

export const zEmail = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .nullable()
  .optional()
  .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address");

export const zUrl = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v : `https://${v}`))
  .nullable()
  .optional()
  .refine((v) => !v || z.string().url().safeParse(v).success, "Enter a valid website URL");
