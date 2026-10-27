import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** JSON round-trip turns Decimal/Date into plain strings for storage. */
function snapshot(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v));
}

export async function audit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: snapshot(input.before),
      after: snapshot(input.after),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  });
}
