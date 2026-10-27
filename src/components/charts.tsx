"use client";
// Recharts wrappers following the app's chart conventions: one y-axis, recessive solid hairline grid,
// <=24px bars with 4px rounded data-ends, 2px lines, legend for >=2 series, hover tooltips.
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactINR, formatINR } from "@/lib/format";

export const CHART = {
  achieved: "#1d53f0",
  target: "#cbd5e1",
  leads: "#f59e0b",
  grid: "#eef2f6",
  axis: "#64748b",
  good: "#059669",
  warn: "#d97706",
  bad: "#dc2626",
};

const axisProps = { tick: { fontSize: 11, fill: CHART.axis }, tickLine: false, axisLine: { stroke: "#e2e8f0" } } as const;

function TooltipBox({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-navy">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="tabular font-medium text-navy">{money ? formatINR(p.value) : p.value?.toLocaleString("en-IN")}</span>
        </p>
      ))}
    </div>
  );
}

/** Grouped target vs actual bars per category (employee/date). */
export function TargetVsActualBars({ data, money, actualLabel, actualColor = CHART.achieved, height = 260 }: { data: { name: string; target: number; actual: number }[]; money?: boolean; actualLabel: string; actualColor?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fontSize: 11, fill: CHART.axis }} />
        <YAxis {...axisProps} width={money ? 64 : 32} tickFormatter={(v) => (money ? formatCompactINR(v) : String(v))} allowDecimals={false} />
        <Tooltip content={<TooltipBox money={money} />} cursor={{ fill: "rgba(29,83,240,0.05)" }} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: CHART.axis }} />
        <Bar dataKey="target" name="Target" fill={CHART.target} radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="actual" name={actualLabel} fill={actualColor} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Trend over time: target vs actual as two 2px lines on one axis. */
export function TrendLines({ data, money, actualLabel, actualColor = CHART.achieved, height = 240 }: { data: { name: string; target: number; actual: number }[]; money?: boolean; actualLabel: string; actualColor?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={money ? 64 : 32} tickFormatter={(v) => (money ? formatCompactINR(v) : String(v))} allowDecimals={false} />
        <Tooltip content={<TooltipBox money={money} />} cursor={{ stroke: "#94a3b8", strokeWidth: 1 }} />
        <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12, color: CHART.axis }} />
        <Line type="monotone" dataKey="target" name="Target" stroke="#94a3b8" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
        <Line type="monotone" dataKey="actual" name={actualLabel} stroke={actualColor} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal achievement-% ranking. Bar color encodes status band (with % label, never color alone). */
export function PctRanking({ data, height }: { data: { name: string; pct: number | null }[]; height?: number }) {
  const rows = data.map((d) => ({ name: d.name, pct: d.pct ?? 0 }));
  const color = (v: number) => (v >= 100 ? CHART.good : v >= 70 ? CHART.achieved : v >= 40 ? CHART.warn : CHART.bad);
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, rows.length * 34 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHART.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={(v) => `${v}%`} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
        <YAxis type="category" dataKey="name" {...axisProps} width={96} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "Achievement"]} cursor={{ fill: "rgba(29,83,240,0.05)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="pct" name="Achievement %" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 11, fill: CHART.axis, formatter: (v: number) => `${v.toFixed(0)}%` }}>
          {rows.map((r) => (
            <Cell key={r.name} fill={color(r.pct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
