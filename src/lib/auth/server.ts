import "server-only";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { SESSION_COOKIE, verifySession } from "./session";
import { ApiError } from "../api";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  employeeId: string | null;
  name: string;
  /** Teams this user leads (managers). */
  ledTeamIds: string[];
}

interface CachedUser {
  user: AuthUser;
  active: boolean;
  sessionVersion: number;
  at: number;
}

// Short-lived cache: the account is re-read from MongoDB at most every 15s per process (each read is a
// network round trip). Password changes clear it immediately via forgetUser().
const CACHE_MS = 15_000;
const cache = new Map<string, CachedUser>();

export function forgetUser(id: string) {
  cache.delete(id);
}

async function loadUser(id: string): Promise<CachedUser | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const row = await prisma.user.findUnique({
    where: { id },
    include: { employee: { include: { ledTeams: { where: { archivedAt: null }, select: { id: true } } } } },
  });
  if (!row) {
    cache.delete(id);
    return null;
  }
  const entry: CachedUser = {
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      employeeId: row.employeeId,
      name: row.employee?.name ?? "Administrator",
      ledTeamIds: row.employee?.ledTeams.map((t) => t.id) ?? [],
    },
    active: row.active && (!row.employee || row.employee.active),
    sessionVersion: row.sessionVersion ?? 0,
    at: Date.now(),
  };
  cache.set(id, entry);
  return entry;
}

/** Resolves the session against the account stored in MongoDB (active, same role, session not revoked). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const found = await loadUser(session.uid);
  if (!found || !found.active || found.user.role !== session.role || found.sessionVersion !== session.sv) return null;
  return found.user;
}

export async function requireUser(roles?: Role[]): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Please sign in to continue.");
  if (roles && !roles.includes(user.role)) throw new ApiError(403, "You do not have permission to perform this action.");
  return user;
}

export const isAdmin = (u: AuthUser) => u.role === "SUPER_ADMIN";
export const isManagerOrAdmin = (u: AuthUser) => u.role === "SUPER_ADMIN" || u.role === "MANAGER";
