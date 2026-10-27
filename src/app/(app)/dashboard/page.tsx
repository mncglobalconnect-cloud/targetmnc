"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, IndianRupee, Percent, Target, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";
import { useApp } from "@/components/app-context";
import { KpiCard, MoneyCell, PageHeader, PctCell, StatusBadge } from "@/components/shared";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Progress, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { PctRanking, TargetVsActualBars, TrendLines, CHART } from "@/components/charts";
import { qs, STATUS_META, useApi } from "@/lib/client";
import { formatDate, formatINR, formatNumber, formatPct } from "@/lib/format";
import { addDays } from "@/lib/dates";
import type { PerformanceResult, PerfRow } from "@/lib/performance";

type SortKey = "employeeName" | "teamName" | "target" | "achieved" | "balance" | "pct" | "leadTarget" | "leads" | "leadBalance" | "status";

export default function DashboardPage() {
  const { date, meta, isEmployee, setQuickAdd } = useApp();
  const day = useApi<PerformanceResult>(`/api/performance${qs({ from: date, to: date, includeIdle: true })}`, { refreshInterval: 60_000 });
  const trendFrom = addDays(date, -13);
  const trend = useApi<PerformanceResult>(`/api/performance${qs({ from: trendFrom, to: date })}`);

  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pct", dir: "desc" });

  const rows = useMemo(() => {
    const list = (day.data?.rows ?? []).filter(
      (r) =>
        (!search || r.employeeName.toLowerCase().includes(search.toLowerCase()) || r.employeeCode.toLowerCase().includes(search.toLowerCase())) &&
        (!teamFilter || r.teamId === teamFilter) &&
        (!statusFilter || r.status === statusFilter),
    );
    const val = (r: PerfRow): string | number => {
      const v = r[sort.key];
      if (sort.key === "target" || sort.key === "achieved" || sort.key === "balance") return Number(v);
      if (v === null || v === undefined) return -1;
      return v as string | number;
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? c : -c;
    });
  }, [day.data, search, teamFilter, statusFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const sorted = (key: SortKey) => (sort.key === key ? sort.dir : null);

  if (day.error) return <ErrorState message={day.error.message} onRetry={() => day.mutate()} />;
  const p = day.data;
  const t = p?.totals;
  const isToday = date === meta.today;

  const chartRows = (p?.rows ?? []).filter((r) => r.hasAllocation || Number(r.achieved) > 0 || r.leads > 0);
  const empMoney = chartRows.map((r) => ({ name: r.employeeName, target: Number(r.target), actual: Number(r.achieved) }));
  const empLeads = chartRows.map((r) => ({ name: r.employeeName, target: r.leadTarget, actual: r.leads }));
  const trendMoney = (trend.data?.byDate ?? []).filter((d) => d.working || Number(d.target) > 0).map((d) => ({ name: formatDate(d.date).slice(0, 6), target: Number(d.target), actual: Number(d.achieved) }));
  const trendLeads = (trend.data?.byDate ?? []).filter((d) => d.working || d.leadTarget > 0).map((d) => ({ name: formatDate(d.date).slice(0, 6), target: d.leadTarget, actual: d.leads }));

  return (
    <>
      <PageHeader
        title={isEmployee ? `Welcome, ${meta.user.name}` : "Performance dashboard"}
        description={`${formatDate(date)}${isToday ? " · Today (live)" : date < meta.today ? " · Past day" : " · Upcoming"} — figures are calculated from saved records.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setQuickAdd("lead")}>
              <UserPlus className="h-4 w-4" /> Add lead
            </Button>
            {(!isEmployee || meta.permissions.employeesCanRecordAchievements) && (
              <Button onClick={() => setQuickAdd("achievement")}>
                <IndianRupee className="h-4 w-4" /> Record achievement
              </Button>
            )}
          </>
        }
      />

      {p && p.missingTargets.length > 0 && !isEmployee && (
        <Alert tone="amber" className="mb-4" title={`${p.missingTargets.length} employee(s) have no target for ${formatDate(date)}`}>
          {p.missingTargets.slice(0, 8).map((m) => m.employeeName).join(", ")}
          {p.missingTargets.length > 8 ? "…" : ""} — <Link href="/targets" className="font-medium underline">assign targets</Link>
        </Alert>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!t ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
        ) : (
          <>
            <KpiCard label="Total assigned target" value={formatINR(t.target)} icon={<Target className="h-4 w-4" />} sub={isEmployee ? "Your target for the day" : "Sum of individual allocations"} />
            <KpiCard label="Total target achieved" value={formatINR(t.achieved)} icon={<TrendingUp className="h-4 w-4" />} tone="green" sub={Number(t.achieved) > Number(t.target) && Number(t.target) > 0 ? `Exceeded by ${formatINR(Number(t.achieved) - Number(t.target))}` : "Qualifying entries only"} />
            <KpiCard label="Remaining target" value={formatINR(t.balance)} icon={<Wallet className="h-4 w-4" />} tone="amber" sub="Never below zero" />
            <KpiCard label="Target achievement" value={formatPct(t.pct)} pct={t.pct} icon={<Percent className="h-4 w-4" />} tone="violet" />
            <KpiCard label="Total lead target" value={formatNumber(t.leadTarget)} icon={<Users className="h-4 w-4" />} />
            <KpiCard label="Total leads generated" value={formatNumber(t.leads)} icon={<UserPlus className="h-4 w-4" />} tone="green" sub="Unique, validated leads" />
            <KpiCard label="Remaining leads" value={formatNumber(t.leadBalance)} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
            <KpiCard label="Lead achievement" value={formatPct(t.leadPct)} pct={t.leadPct} icon={<Percent className="h-4 w-4" />} tone="violet" />
          </>
        )}
      </div>

      {/* Status summary */}
      {p && Object.keys(p.statusCounts).length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {Object.entries(p.statusCounts).map(([s, c]) => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "" : s)} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <span className={statusFilter && statusFilter !== s ? "opacity-40" : ""}>
                <StatusBadge status={s} />
              </span>
              <span className="ml-1 text-xs text-slate-500">{c}</span>
            </button>
          ))}
          {isToday && <span className="text-xs text-slate-400">· Status adjusts for time of day ({meta.workday.start}–{meta.workday.end})</span>}
        </div>
      )}

      {/* Team progress */}
      {p && p.byTeam.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {p.byTeam.map((tm) => (
            <Card key={tm.teamId} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{tm.teamName}</p>
                  <p className="text-xs text-slate-500">
                    {tm.memberCount} member(s) · {tm.modes.length ? tm.modes.map((m) => (m === "ALLOCATED" ? "Allocated target" : "Independent goal")).join(", ") : "Sum of member targets"}
                  </p>
                </div>
                {tm.locked && <Badge tone="slate">Locked</Badge>}
              </div>
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-slate-500">
                      <span className="tabular font-medium text-navy">{formatINR(tm.achieved)}</span> of {formatINR(tm.goalTarget)}
                    </span>
                    <PctCell value={tm.goalPct} />
                  </div>
                  <Progress value={tm.goalPct} />
                  <p className="mt-1 text-slate-500">Remaining {formatINR(tm.goalBalance)}{tm.goalTarget !== tm.memberTarget && ` · allocated to members ${formatINR(tm.memberTarget)}`}</p>
                </div>
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-slate-500">
                      <span className="tabular font-medium text-navy">{tm.leads}</span> of {tm.goalLeadTarget} leads
                    </span>
                    <PctCell value={tm.goalLeadPct} />
                  </div>
                  <Progress value={tm.goalLeadPct} />
                  <p className="mt-1 text-slate-500">{tm.goalLeadBalance} lead(s) remaining</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Daily target vs achievement" description={`By employee · ${formatDate(date)}`} />
          <CardBody>{!p ? <Skeleton className="h-[260px]" /> : empMoney.length ? <TargetVsActualBars data={empMoney} money actualLabel="Achieved" /> : <EmptyState title="No targets or achievements for this date" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Daily lead target vs actual leads" description={`By employee · ${formatDate(date)}`} />
          <CardBody>{!p ? <Skeleton className="h-[260px]" /> : empLeads.length ? <TargetVsActualBars data={empLeads} actualLabel="Leads added" actualColor={CHART.leads} /> : <EmptyState title="No lead targets for this date" />}</CardBody>
        </Card>
        {!isEmployee && (
          <Card>
            <CardHeader title="Employee performance ranking" description="Target achievement % (ratio of achieved to assigned)" />
            <CardBody>{!p ? <Skeleton className="h-[220px]" /> : p.byEmployee.filter((e) => Number(e.target) > 0).length ? <PctRanking data={p.byEmployee.filter((e) => Number(e.target) > 0).map((e) => ({ name: e.employeeName, pct: e.pct }))} /> : <EmptyState title="No assigned targets yet" />}</CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Team performance comparison" description="Achievement % against each team's target" />
          <CardBody>{!p ? <Skeleton className="h-[220px]" /> : p.byTeam.length ? <PctRanking data={p.byTeam.map((x) => ({ name: x.teamName, pct: x.goalPct }))} /> : <EmptyState title="No team data" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Target achievement trend" description={`${formatDate(trendFrom)} – ${formatDate(date)}`} />
          <CardBody>{!trend.data ? <Skeleton className="h-[240px]" /> : <TrendLines data={trendMoney} money actualLabel="Achieved" />}</CardBody>
        </Card>
        <Card className={isEmployee ? "" : "xl:col-span-2"}>
          <CardHeader title="Lead generation trend" description={`${formatDate(trendFrom)} – ${formatDate(date)}`} />
          <CardBody>{!trend.data ? <Skeleton className="h-[240px]" /> : <TrendLines data={trendLeads} actualLabel="Leads" actualColor={CHART.leads} />}</CardBody>
        </Card>
      </div>

      {/* Performance table */}
      <Card className="mt-6">
        <CardHeader
          title={isEmployee ? "My performance" : "Employee performance"}
          description="Balances never go below zero; overachievement is kept in the achieved value."
          action={
            !isEmployee && (
              <>
                <Input placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-44" />
                <Select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="w-40">
                  <option value="">All teams</option>
                  {meta.teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </Select>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </>
            )
          }
        />
        {!p ? (
          <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No matching employees" description="Adjust the filters or assign targets for this date." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th onClick={() => toggleSort("employeeName")} sorted={sorted("employeeName")}>Employee</Th>
                <Th onClick={() => toggleSort("teamName")} sorted={sorted("teamName")}>Team</Th>
                <Th align="right" onClick={() => toggleSort("target")} sorted={sorted("target")}>Target</Th>
                <Th align="right" onClick={() => toggleSort("achieved")} sorted={sorted("achieved")}>Achieved</Th>
                <Th align="right" onClick={() => toggleSort("balance")} sorted={sorted("balance")}>Balance</Th>
                <Th align="right" onClick={() => toggleSort("pct")} sorted={sorted("pct")}>Target %</Th>
                <Th align="right" onClick={() => toggleSort("leadTarget")} sorted={sorted("leadTarget")}>Lead target</Th>
                <Th align="right" onClick={() => toggleSort("leads")} sorted={sorted("leads")}>Leads added</Th>
                <Th align="right" onClick={() => toggleSort("leadBalance")} sorted={sorted("leadBalance")}>Leads balance</Th>
                <Th onClick={() => toggleSort("status")} sorted={sorted("status")}>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-slate-50/60">
                  <Td>
                    <span className="font-medium">{r.employeeName}</span> <span className="text-xs text-slate-400">{r.employeeCode}</span>
                    {!r.hasAllocation && <Badge tone="amber" className="ml-2">No target</Badge>}
                  </Td>
                  <Td className="text-slate-600">{r.teamName ?? "—"}</Td>
                  <Td align="right"><MoneyCell value={r.target} /></Td>
                  <Td align="right"><MoneyCell value={r.achieved} className="font-medium" /></Td>
                  <Td align="right"><MoneyCell value={r.balance} /></Td>
                  <Td align="right"><PctCell value={r.pct} /></Td>
                  <Td align="right">{r.leadTarget}</Td>
                  <Td align="right" className="font-medium">{r.leads}</Td>
                  <Td align="right">{r.leadBalance}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <Td>Total ({rows.length})</Td>
                  <Td />
                  <Td align="right"><MoneyCell value={rows.reduce((s, r) => s + Number(r.target), 0)} /></Td>
                  <Td align="right"><MoneyCell value={rows.reduce((s, r) => s + Number(r.achieved), 0)} /></Td>
                  <Td align="right"><MoneyCell value={Math.max(rows.reduce((s, r) => s + Number(r.target) - Number(r.achieved), 0), 0)} /></Td>
                  <Td align="right">
                    <PctCell value={(() => { const tt = rows.reduce((s, r) => s + Number(r.target), 0); return tt > 0 ? Math.round((rows.reduce((s, r) => s + Number(r.achieved), 0) / tt) * 10000) / 100 : null; })()} />
                  </Td>
                  <Td align="right">{rows.reduce((s, r) => s + r.leadTarget, 0)}</Td>
                  <Td align="right">{rows.reduce((s, r) => s + r.leads, 0)}</Td>
                  <Td align="right">{Math.max(rows.reduce((s, r) => s + r.leadTarget - r.leads, 0), 0)}</Td>
                  <Td />
                </tr>
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </>
  );
}
