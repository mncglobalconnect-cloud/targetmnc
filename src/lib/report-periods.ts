import { addDays, endOfMonth, isIsoDate, startOfMonth, startOfWeek, toDbDate } from "./dates";

export type ReportPeriod = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export function periodRange(period: Exclude<ReportPeriod, "custom">, date: string): [string, string] {
  if (!isIsoDate(date)) throw new Error("Choose a valid report date.");
  switch (period) {
    case "daily": return [date, date];
    case "weekly": {
      const start = startOfWeek(date);
      return [start, addDays(start, 6)];
    }
    case "monthly": return [startOfMonth(date), endOfMonth(date)];
    case "yearly": return [`${date.slice(0, 4)}-01-01`, `${date.slice(0, 4)}-12-31`];
  }
}

export function resolveReportRange(input: { period?: ReportPeriod; date?: string; from?: string; to?: string }): { period: ReportPeriod; from: string; to: string } {
  let from = input.from;
  let to = input.to;
  const period = input.period ?? (from && from === to ? "daily" : "custom");
  if (period !== "custom") {
    const date = input.date ?? from;
    if (!date) throw new Error("Choose a date for the selected report period.");
    const range = periodRange(period, date);
    if ((from && from !== range[0]) || (to && to !== range[1])) throw new Error("The provided dates do not match the selected report period.");
    [from, to] = range;
  }
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("Provide valid start and end dates.");
  if (from > to) throw new Error("Start date must be on or before end date.");
  if ((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000 + 1 > 366) throw new Error("Reports are limited to 366 days, including leap years.");
  return { period, from, to };
}
