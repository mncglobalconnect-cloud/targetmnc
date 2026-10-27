import { ApiError } from "./api";

// In-memory fixed-window limiter. Suitable for a single instance; use Redis for multi-instance deployments.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    const secs = Math.ceil((b.resetAt - now) / 1000);
    throw new ApiError(429, `Too many requests. Please wait ${secs}s and try again.`);
  }
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
