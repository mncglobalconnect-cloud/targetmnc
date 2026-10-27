import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

const COMPANY_SUFFIXES = /\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|co|company|india|the)\b/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Digits only, keeping the last 10 for Indian numbers (+91 / 0 prefixes stripped). */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Leads that count toward targets: valid, not merged away, not deleted, flagged as counting. */
export const COUNTABLE_LEAD: Prisma.LeadWhereInput = {
  deletedAt: null,
  mergedIntoId: null,
  validation: "VALID",
  countsTowardTarget: true,
};

export interface DuplicateMatch {
  id: string;
  companyName: string;
  phone: string;
  email: string | null;
  ownerName: string;
  leadDate: string;
  status: string;
  matchedOn: ("company" | "email" | "phone")[];
  exact: boolean;
}

/** Employees learn that a duplicate exists, but not other people's contact details. */
export function maskDuplicates(role: string, dups: DuplicateMatch[]): DuplicateMatch[] {
  if (role !== "EMPLOYEE") return dups;
  return dups.map((d) => ({ ...d, phone: d.phone.replace(/\d(?=\d{3})/g, "•"), email: d.email ? "hidden" : null }));
}

export async function findDuplicates(input: { companyName: string; email?: string | null; phone: string }, excludeId?: string): Promise<DuplicateMatch[]> {
  const companyNorm = normalizeCompany(input.companyName);
  const emailNorm = normalizeEmail(input.email);
  const phoneNorm = normalizePhone(input.phone);
  const or: Prisma.LeadWhereInput[] = [];
  if (companyNorm) or.push({ companyNameNorm: companyNorm });
  if (emailNorm) or.push({ emailNorm });
  if (phoneNorm.length >= 7) or.push({ phoneNorm });
  if (!or.length) return [];

  const rows = await prisma.lead.findMany({
    where: { OR: or, deletedAt: null, mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { owner: { select: { name: true } } },
    take: 10,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => {
    const matchedOn: DuplicateMatch["matchedOn"] = [];
    if (companyNorm && r.companyNameNorm === companyNorm) matchedOn.push("company");
    if (emailNorm && r.emailNorm === emailNorm) matchedOn.push("email");
    if (phoneNorm.length >= 7 && r.phoneNorm === phoneNorm) matchedOn.push("phone");
    return {
      id: r.id,
      companyName: r.companyName,
      phone: r.phone,
      email: r.email,
      ownerName: r.owner.name,
      leadDate: r.leadDate.toISOString().slice(0, 10),
      status: r.status,
      matchedOn,
      exact: matchedOn.includes("email") || matchedOn.includes("phone"),
    };
  });
}
