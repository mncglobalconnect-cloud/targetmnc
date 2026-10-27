import { z } from "zod";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedPerformance } from "@/lib/perf-access";
import { zDate } from "@/lib/validation";

const schema = z.object({
  from: zDate,
  to: zDate,
  teamId: z.string().optional(),
  departmentId: z.string().optional(),
  employeeId: z.string().optional(),
  includeIdle: z.enum(["true", "false"]).optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, schema);
  return ok(await scopedPerformance(user, { ...q, includeIdle: q.includeIdle === "true" }));
});
