import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { findDuplicates, maskDuplicates } from "@/lib/leads";

const schema = z.object({
  companyName: z.string().trim().max(200).default(""),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(25).default(""),
  excludeId: z.string().optional(),
});

/** Live duplicate warning for the lead form (normalized company name, email and phone). */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, schema);
  return ok({ duplicates: maskDuplicates(user.role, await findDuplicates(body, body.excludeId)) });
});
