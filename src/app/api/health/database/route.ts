import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getMongoConnection } from "@/lib/mongo-store";

export const GET = route(async () => {
  await requireUser(["SUPER_ADMIN"]);
  const { db } = await getMongoConnection();
  await db.command({ ping: 1 });
  return ok({ ok: true, provider: "mongodb", transactions: true });
});
