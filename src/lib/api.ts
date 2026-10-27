import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { isDatabaseError } from "./mongo-store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;

/** Wraps a route handler with consistent error responses. */
export function route(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (isDatabaseError(err)) {
    console.error("[database]", err.message);
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const flat = err.flatten();
    const first = err.issues[0];
    const message = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
    return NextResponse.json({ error: message, details: flat.fieldErrors }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: "A record with these details already exists.", details: err.meta }, { status: 409 });
    }
    if (err.code === "P2025") return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Something went wrong on the server. Please try again." }, { status: 500 });
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
