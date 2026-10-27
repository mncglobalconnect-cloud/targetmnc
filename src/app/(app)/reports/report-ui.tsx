"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart,
} from "recharts";
import { Button, Field, Select } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { downloadUrl, qs } from "@/lib/client";
import { formatCompactINR, formatDate, formatINR, formatNumber } from "@/lib/format";
import type { ReportPeriod } from "@/lib/report-periods";

// Validated with the dataviz palette checker (light surface): both pass lightness, chroma, CVD and contrast.
export const SERIES = { achieved: "#1d53f0", target: "#0f9d8f" };
const AXIS = { fontSize: 11, fill: "#64748b" };
const GRID = "#eef2f7";

export interface ReportFilterValue {
  teamId: string;
  departmentId: string;
  employeeId: string;
}

export function ReportFilters({ value, onChange }: { value: ReportFilterValue; onChange: (v: ReportFilterValue) => void }) {
  const { meta, isEmployee } = useApp();
  if (isEmployee) return null;
  const set = (k: keyof ReportFilterValue) => (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label="Team">
        <Select value={value.teamId} onChange={set("teamId")}>
          <option value="">All teams</option>
          {meta.teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Department">
        <Select value={value.departmentId} onChange={set("departmentId")}>
          <option value="">All departments</option>
          {meta.departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Employee">
        <Select value={value.employeeId} onChange={set("employeeId")}>
          <option value="">All employees</option>
          {meta.employees.filter((e) => e.role !== "SUPER_ADMIN").map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({e.code})</option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export function ExportButtons({ from, to, filters, period = from === to ? "daily" : "custom" }: { from: string; to: string; filters: ReportFilterValue; period?: ReportPeriod }) {
  const [downloading, setDownloading] = useState(false);
  const base = { from, to, period, teamId: filters.teamId, employeeId: filters.employeeId, departmentId: filters.departmentId };
  const download = async (format: "xlsx" | "csv", dataset?: string) => {
    setDownloading(true);
    try { await downloadUrl(`/api/export${qs({ ...base, format, dataset })}`); }
    finally { setDownloading(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" loading={downloading} onClick={() => download("xlsx")}>
        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Download Excel
      </Button>
      <Select
        className="h-8 w-auto text-xs"
        value=""
        aria-label="Export CSV"
        disabled={downloading}
        onChange={(e) => {
          if (e.target.value) download("csv", e.target.value);
          e.target.value = "";
        }}
      >
        <option value="">CSV export…</option>
        <option value="performance">Employee performance</option>
        <option value="teams">Team performance</option>
        <option value="achievements">Achievement entries</option>
        <option value="leads">Lead records</option>
      </Select>
    </div>
  );
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-navy">{label && /^\d{4}-\d{2}-\d{2}$/.test(label) ? formatDate(label) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="tabular font-medium text-navy">{money ? formatINR(p.value) : formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const shortDate = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Achieved as bars, target as a line — same unit (₹), one axis. */
export function TargetVsAchievedChart({ data, money = true, height = 260 }: { data: { label: string; target: number; achieved: number }[]; money?: boolean; height?: number }) {
  const isDate = data.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(data[0].label);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} tickFormatter={isDate ? shortDate : undefined} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={money ? 64 : 36} tickFormatter={(v: number) => (money ? formatCompactINR(v) : String(v))} allowDecimals={!money ? false : true} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: "rgba(29,83,240,0.06)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#475569" }} />
        <Bar dataKey="achieved" name={money ? "Achieved" : "Leads generated"} fill={SERIES.achieved} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line dataKey="target" name={money ? "Target" : "Lead target"} stroke={SERIES.target} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Team goal vs achieved, grouped bars with a 2px gap. */
export function TeamComparisonChart({ data, height = 260 }: { data: { label: string; target: number; achieved: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatCompactINR(v)} />
        <Tooltip content={<ChartTooltip money />} cursor={{ fill: "rgba(29,83,240,0.06)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#475569" }} />
        <Bar dataKey="target" name="Team goal" fill={SERIES.target} radius={[4, 4, 0, 0]} maxBarSize={36} />
        <Bar dataKey="achieved" name="Achieved" fill={SERIES.achieved} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
