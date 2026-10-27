// Business dates are plain "YYYY-MM-DD" strings in application code and
// UTC-midnight Date objects at the typed storage boundary.

export const DEFAULT_TZ = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function toDbDate(s: string): Date {
  if (!isIsoDate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayInTz(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Minutes since local midnight in the business timezone. */
export function minutesNowInTz(tz = DEFAULT_TZ, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function addDays(s: string, n: number): string {
  const d = toDbDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDbDate(d);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 1000) throw new Error("Date range too large (max 1000 days)");
  }
  return out;
}

export function weekday(s: string): number {
  return toDbDate(s).getUTCDay(); // 0 = Sunday
}

export function startOfWeek(s: string): string {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd); // Monday-based weeks
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 8)}01`;
}

export function endOfMonth(s: string): string {
  const d = toDbDate(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromDbDate(d);
}

export function formatDisplayDate(s: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(toDbDate(s));
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
