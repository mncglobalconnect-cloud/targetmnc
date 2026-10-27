"use client";
import { useMemo, useState } from "react";
import { Award, CalendarRange, IndianRupee, Percent, Target, TrendingDown, UserPlus } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, Skeleton, Table, Tabs, Td, Th } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { KpiCard, MoneyCell, PageHeader, PctCell, StatusBadge } from "@/components/shared";
import { qs, useApi } from "@/lib/client";
import { addDays, endOfMonth, startOfMonth, startOfWeek } from "@/lib/dates";
import { periodRange, type ReportPeriod } from "@/lib/report-periods";
import { formatDate, formatINR, formatNumber, formatPct } from "@/lib/format";
import type { EmployeeAgg, PerformanceResult } from "@/lib/performance";
import { ExportButtons, ReportFilters, TargetVsAchievedChart, TeamComparisonChart, type ReportFilterValue } from "../report-ui";

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "this-year" | "last-year" | "custom";

interface PeriodicReport extends PerformanceResult {
  conversion: { total: number; converted: number; conversionRate: number | null; convertedValue: string; byStatus: Record<string, number> };
  best: EmployeeAgg[];
  consistentlyMissing: EmployeeAgg[];
  summary: { workingDays: number; daysWithTargets: number; averageEmployeePct: number | null };
}

function rangeFor(p: Preset, d: string): [string, string] {
  switch (p) {
    case "this-week": {
      const s = startOfWeek(d);
      return [s, addDays(s, 6)];
    }
    case "last-week": {
      const s = addDays(startOfWeek(d), -7);
      return [s, addDays(s, 6)];
    }
    case "this-month":
      return [startOfMonth(d), endOfMonth(d)];
    case "last-month": {
      const prev = addDays(startOfMonth(d), -1);
      return [startOfMonth(prev), endOfMonth(prev)];
    }
    case "this-year":
      return periodRange("yearly", d);
    case "last-year":
      return periodRange("yearly", `${Number(d.slice(0, 4)) - 1}-01-01`);
    default:
      return [startOfMonth(d), d];
  }
}

export default function PeriodicReportPage() {
  const { date } = useApp();
  const [preset, setPreset] = useState<Preset>("this-month");
  const [custom, setCustom] = useState<[string, string]>(() => rangeFor("custom", date));
  const [filters, setFilters] = useState<ReportFilterValue>({ teamId: "", departmentId: "", employeeId: "" });
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, date);
  const valid = from <= to;
  const period: ReportPeriod = preset === "custom" ? "custom" : preset.endsWith("week") ? "weekly" : preset.endsWith("month") ? "monthly" : "yearly";
  const { data, error, isLoading, mutate } = useApi<PeriodicReport>(valid ? `/api/reports/periodic${qs({ from, to, ...filters })}` : null);

  const daily = useMemo(() => (data?.byDate ?? []).filter((d) => d.working || Number(d.target) > 0 || Number(d.achieved) > 0), [data]);
  const t = data?.totals;

  return (
    <>
      <PageHeader title="Weekly, Monthly & Yearly Reports" description={`${formatDate(from)} – ${formatDate(to)} · Saved in MongoDB, downloaded as Excel`} actions={valid && <ExportButtons from={from} to={to} period={period} filters={filters} />} />

      <Card className="mb-6">
        <CardBody className="space-y-4">
          <Tabs<Preset>
            value={preset}
            onChange={setPreset}
            className="flex-wrap"
            tabs={[
              { value: "this-week", label: "This week" },
              { value: "last-week", label: "Last week" },
              { value: "this-month", label: "This month" },
              { value: "last-month", label: "Last month" },
              { value: "this-year", label: "This year" },
              { value: "last-year", label: "Last year" },
              { value: "custom", label: "Custom range" },
            ]}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {preset === "custom" && (
              <>
                <Field label="From">
                  <Input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
                </Field>
                <Field label="To" error={!valid ? "End must be on/after start" : null}>
                  <Input type="date" value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} />
                </Field>
              </>
            )}
            <ReportFilters value={filters} onChange={setFilters} />
          </div>
        </CardBody>
      </Card>

      {error ? (
        <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>
      ) : isLoading || !data || !t ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Total targets assigned" value={formatINR(t.target)} icon={<Target className="h-4 w-4" />} sub={`${data.summary.daysWithTargets} day(s) with targets · ${data.summary.workingDays} working day(s)`} />
            <KpiCard label="Total achievement" value={formatINR(t.achieved)} icon={<IndianRupee className="h-4 w-4" />} tone="green" pct={t.pct} />
            <KpiCard label="Target balance" value={formatINR(t.balance)} tone="amber" />
            <KpiCard
              label="Achievement % (total ÷ total)"
              value={formatPct(t.pct)}
              icon={<Percent className="h-4 w-4" />}
              tone="violet"
              pct={t.pct}
              sub={<>Avg. of employee %: <b>{formatPct(data.summary.averageEmployeePct)}</b> (secondary)</>}
            />
            <KpiCard label="Lead target" value={formatNumber(t.leadTarget)} icon={<UserPlus className="h-4 w-4" />} />
            <KpiCard label="Leads generated" value={formatNumber(t.leads)} tone="green" pct={t.leadPct} sub={`${formatPct(t.leadPct)} of lead target`} />
            <KpiCard label="Lead balance" value={formatNumber(t.leadBalance)} tone="amber" />
            <KpiCard
              label="Lead conversion rate"
              value={formatPct(data.conversion.conversionRate)}
              tone="violet"
              sub={`${data.conversion.converted} of ${data.conversion.total} leads converted · ${formatINR(data.conversion.convertedValue)} converted value`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title="Daily target vs achievement" description="Qualifying achievement only (₹)" />
              <CardBody>
                {daily.length ? <TargetVsAchievedChart data={daily.map((d) => ({ label: d.date, target: Number(d.target), achieved: Number(d.achieved) }))} /> : <EmptyState title="No data in range" />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Daily leads vs lead target" description="Unique, validated leads by creation date" />
              <CardBody>
                {daily.length ? <TargetVsAchievedChart money={false} data={daily.map((d) => ({ label: d.date, target: d.leadTarget, achieved: d.leads }))} /> : <EmptyState title="No data in range" />}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="xl:col-span-2">
              <CardHeader title="Team performance ranking" description="Achievement against the team goal; member allocations shown for reference (team goals never add to company totals)." />
              {data.byTeam.length === 0 ? (
                <EmptyState title="No team data" />
              ) : (
                <>
                  <CardBody className="pb-0">
                    <TeamComparisonChart data={data.byTeam.map((x) => ({ label: x.teamName, target: Number(x.goalTarget), achieved: Number(x.achieved) }))} height={220} />
                  </CardBody>
                  <Table>
                    <thead>
                      <tr>
                        <Th>#</Th><Th>Team</Th><Th align="right">Team goal</Th><Th align="right">Member allocations</Th><Th align="right">Achieved</Th>
                        <Th align="right">Balance</Th><Th align="right">%</Th><Th align="right">Lead goal</Th><Th align="right">Leads</Th><Th align="right">Lead %</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byTeam.map((x, i) => (
                        <tr key={x.teamId}>
                          <Td className="text-slate-400">{i + 1}</Td>
                          <Td>
                            <span className="font-medium">{x.teamName}</span>
                            {x.modes.length > 0 && <span className="block text-[11px] text-slate-400">{x.modes.map((m) => (m === "ALLOCATED" ? "Allocated" : "Independent")).join(", ")}</span>}
                          </Td>
                          <Td align="right"><MoneyCell value={x.goalTarget} /></Td>
                          <Td align="right" className="text-slate-500"><MoneyCell value={x.memberTarget} /></Td>
                          <Td align="right"><MoneyCell value={x.achieved} className="font-medium" /></Td>
                          <Td align="right"><MoneyCell value={x.goalBalance} /></Td>
                          <Td align="right"><PctCell value={x.goalPct} /></Td>
                          <Td align="right">{x.goalLeadTarget}</Td>
                          <Td align="right">{x.leads}</Td>
                          <Td align="right"><PctCell value={x.goalLeadPct} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader title={<span className="flex items-center gap-1.5"><Award className="h-4 w-4 text-violet-600" /> Best performers</span>} />
                <CardBody className="space-y-2">
                  {data.best.length === 0 && <p className="text-xs text-slate-500">No employees with targets in this range.</p>}
                  {data.best.map((e, i) => (
                    <div key={e.employeeId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate"><span className="mr-2 text-slate-400">{i + 1}.</span>{e.employeeName}</span>
                      <PctCell value={e.pct} />
                    </div>
                  ))}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title={<span className="flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-red-600" /> Consistently missing targets</span>} description="Missed or partial on ≥ 50% of targeted days" />
                <CardBody className="space-y-2">
                  {data.consistentlyMissing.length === 0 && <p className="text-xs text-slate-500">No one is consistently missing targets. 🎉</p>}
                  {data.consistentlyMissing.map((e) => (
                    <div key={e.employeeId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{e.employeeName}</span>
                      <Badge tone="red">{e.daysMissed}/{e.days} days</Badge>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Employee performance ranking" description="Range totals — percentages are total achieved ÷ total target, not an average of daily percentages." />
            {data.byEmployee.length === 0 ? (
              <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No employee records in this range" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th><Th>Employee</Th><Th>Team</Th><Th align="right">Target</Th><Th align="right">Achieved</Th><Th align="right">Balance</Th><Th align="right">%</Th>
                    <Th align="right">Lead target</Th><Th align="right">Leads</Th><Th align="right">Lead %</Th><Th align="right">Days met</Th><Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.byEmployee.map((e, i) => (
                    <tr key={e.employeeId} className="hover:bg-slate-50">
                      <Td className="text-slate-400">{i + 1}</Td>
                      <Td><span className="font-medium">{e.employeeName}</span><span className="block text-[11px] text-slate-400">{e.employeeCode}</span></Td>
                      <Td className="text-slate-600">{e.teamName ?? "—"}</Td>
                      <Td align="right"><MoneyCell value={e.target} /></Td>
                      <Td align="right"><MoneyCell value={e.achieved} className="font-medium" /></Td>
                      <Td align="right"><MoneyCell value={e.balance} /></Td>
                      <Td align="right"><PctCell value={e.pct} /></Td>
                      <Td align="right">{e.leadTarget}</Td>
                      <Td align="right">{e.leads}</Td>
                      <Td align="right"><PctCell value={e.leadPct} /></Td>
                      <Td align="right">{e.daysTargetMet}/{e.days}</Td>
                      <Td><StatusBadge status={e.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
