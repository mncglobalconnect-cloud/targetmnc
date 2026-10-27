import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function dec(v: Prisma.Decimal.Value | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(v);
}

/** Serialize a Decimal to a fixed 2dp string for JSON transport (no float rounding). */
export function money(v: Prisma.Decimal.Value | null | undefined): string {
  return dec(v).toFixed(2);
}
