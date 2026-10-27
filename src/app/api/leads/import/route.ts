import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, teamOnDate } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { isIsoDate, toDbDate, todayInTz } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { findDuplicates, normalizeCompany, normalizeEmail, normalizePhone } from "@/lib/leads";

const rowSchema = z.object({
  companyName: z.string().trim().min(2, "Company name required").max(200),
  phone: z.string().trim().min(7, "Phone required").max(25),
  contactPerson: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  industry: z.string().trim().max(80).optional().nullable(),
  source: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  leadDate: z.string().optional().nullable(),
});

const schema = z.object({
  ownerId: z.string().min(1),
  rows: z.array(z.record(z.unknown())).min(1).max(1000),
});

/**
 * Spreadsheet import. Imported leads are created as PENDING_VALIDATION and do not affect target
 * counts until a manager validates them (POST /api/leads/validate).
 */
export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN", "MANAGER"]);
  rateLimit(`import:${user.id}`, 5, 60_000);
  const body = await parseBody(req, schema);
  await assertEmployeeAccess(user, body.ownerId);
  const owner = await prisma.employee.findUnique({ where: { id: body.ownerId } });
  if (!owner) throw new ApiError(400, "Owner not found.");
  const settings = await getSettings();
  const today = todayInTz(settings.timezone);
  const batch = randomUUID();

  const errors: { row: number; message: string }[] = [];
  let created = 0;
  let flaggedDuplicates = 0;
  const seen = new Set<string>();
  for (let i = 0; i < body.rows.length; i++) {
    const parsed = rowSchema.safeParse(body.rows[i]);
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    const r = parsed.data;
    const leadDate = r.leadDate && isIsoDate(r.leadDate) && r.leadDate <= today ? r.leadDate : today;
    const phoneNorm = normalizePhone(r.phone);
    const emailNorm = normalizeEmail(r.email);
    if (r.email && !z.string().email().safeParse(r.email).success) {
      errors.push({ row: i + 2, message: "Invalid email" });
      continue;
    }
    const inFileKey = `${normalizeCompany(r.companyName)}|${phoneNorm}`;
    if (seen.has(inFileKey)) {
      errors.push({ row: i + 2, message: "Duplicate row within the file (skipped)" });
      continue;
    }
    seen.add(inFileKey);
    const dups = await findDuplicates({ companyName: r.companyName, email: r.email, phone: r.phone });
    if (dups.length) flaggedDuplicates++;
    const d = toDbDate(leadDate);
    const teamId = await teamOnDate(owner.id, d);
    const lead = await prisma.lead.create({
      data: {
        companyName: r.companyName,
        companyNameNorm: normalizeCompany(r.companyName),
        contactPerson: r.contactPerson || null,
        email: r.email || null,
        emailNorm,
        phone: r.phone,
        phoneNorm,
        website: r.website || null,
        industry: r.industry || null,
        source: r.source || "Spreadsheet import",
        notes: [r.notes, dups.length ? `Possible duplicate of: ${dups.map((x) => x.companyName).join(", ")}` : null].filter(Boolean).join("\n") || null,
        leadDate: d,
        ownerId: owner.id,
        teamId,
        creditedEmployeeId: owner.id,
        creditedTeamId: teamId,
        validation: "PENDING_VALIDATION",
        importBatch: batch,
        createdById: user.id,
      },
    });
    await prisma.leadActivity.create({ data: { leadId: lead.id, type: "CREATED", description: `Imported from spreadsheet (batch ${batch.slice(0, 8)})`, createdById: user.id } });
    await prisma.leadAssignment.create({ data: { leadId: lead.id, toEmployeeId: owner.id, reason: "Imported", changedById: user.id } });
    created++;
  }
  await audit({ actorId: user.id, action: "LEADS_IMPORTED", entityType: "Lead", after: { batch, created, flaggedDuplicates, errors: errors.length, ownerId: owner.id }, ip: clientIp(req) });
  return ok({ batch, created, flaggedDuplicates, errors });
});
