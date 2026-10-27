// Client-safe display formatting. Values arrive from the API as strings/numbers.

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN");

export function formatINR(v: string | number | null | undefined, precise = false): string {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  if (!Number.isFinite(n)) return "—";
  return (precise ? inr2 : inr).format(n);
}

export function formatCompactINR(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return formatINR(n);
}

export function formatNumber(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : num.format(v);
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(v % 1 === 0 ? 0 : 2)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function titleCase(s: string): string {
  return s.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
