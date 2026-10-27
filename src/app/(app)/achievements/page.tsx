"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IndianRupee, Pencil, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-context";
import { AchievementFormDialog, type AchievementEditing } from "@/components/forms/achievement-form";
import { KpiCard, MoneyCell, PageHeader, useReasonPrompt } from "@/components/shared";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Pagination, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { api, ApiClientError, qs, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatDateTime, formatINR, formatPct } from "@/lib/format";
import type { PerformanceResult } from "@/lib/performance";

interface Row {
  id: string;
  date: string;
  amount: string;
  countsTowardTarget: boolean;
  description: string | null;
  referenceNo: string | null;
  notes: string | null;
  categoryId: string;
  leadId: string | null;
  employeeId: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; name: string; code: string };
  team: { id: string; name: string } | null;
  category: { id: string; name: string; code: string };
  lead: { id: string; companyName: string } | null;
}

export default function AchievementsPage() {
  const { date, meta, isEmployee, setQuickAdd } = useApp();
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [employeeId, setEmployeeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AchievementEditing | null>(null);
  const reason = useReasonPrompt();

  useEffect(() => {
    setFrom(date);
    setTo(date);
    setPage(1);
  }, [date]);

  const list = useApi<{ total: number; page: number; pageSize: number; rows: Row[]; sums: { qualifying: string; nonQualifying: string } }>(
    `/api/achievements${qs({ from, to, employeeId, teamId, categoryId, q, page, pageSize: 25 })}`,
  );
  const perfEmp = isEmployee ? meta.user.employeeId : employeeId;
  const perf = useApi<PerformanceResult>(from === to ? `/api/performance${qs({ from, to, employeeId: perfEmp || undefined, teamId: teamId || undefined })}` : null);
  const t = perf.data?.totals;

  const canEdit = (r: Row) => !isEmployee || (meta.permissions.employeesCanEditOwnSameDay && r.createdById === meta.user.id && r.date === meta.today);

  const voidEntry = async (r: Row) => {
    const why = await reason.prompt(`Void ₹${Number(r.amount).toLocaleString("en-IN")} entry for ${r.employee.name}?`);
    if (!why) return;
    try {
      await api(`/api/achievements/${r.id}`, { method: "DELETE", body: { reason: why } });
      toast.success("Entry voided — totals recalculated");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not void entry");
    }
  };

  return (
    <>
      <PageHeader
        title="Achievement entry"
        description="Record completed business. Multiple entries per employee per day are added together; pipeline categories are kept separate."
        actions={
          (!isEmployee || meta.permissions.employeesCanRecordAchievements) && (
            <Button onClick={() => setQuickAdd("achievement")}>
              <IndianRupee className="h-4 w-4" /> Record achievement
            </Button>
          )
        }
      />

      {from === to && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!t ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
          ) : (
            <>
              <KpiCard label={`Target · ${formatDate(from)}`} value={formatINR(t.target)} sub={perfEmp ? meta.employees.find((e) => e.id === perfEmp)?.name : "All employees in view"} />
              <KpiCard label="Achieved (qualifying)" value={formatINR(t.achieved)} tone="green" />
              <KpiCard label="Remaining target" value={formatINR(t.balance)} tone="amber" />
              <KpiCard label="Achievement" value={formatPct(t.pct)} pct={t.pct} tone="violet" />
            </>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title="Achievement history"
          description={list.data ? `Qualifying ${formatINR(list.data.sums.qualifying)} · Pipeline (not counted) ${formatINR(list.data.sums.nonQualifying)}` : "Loading…"}
        />
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </Field>
          {!isEmployee && (
            <Field label="Employee">
              <Select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}>
                <option value="">All</option>
                {meta.employees.filter((e) => e.role !== "SUPER_ADMIN").map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </Select>
            </Field>
          )}
          {!isEmployee && (
            <Field label="Team">
              <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); setPage(1); }}>
                <option value="">All</option>
                {meta.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Description, ref, lead" />
          </Field>
        </div>
        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => list.mutate()} />
        ) : !list.data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : list.data.rows.length === 0 ? (
          <EmptyState icon={<IndianRupee className="h-5 w-5" />} title="No achievements recorded" description="Entries appear here as soon as they are saved." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Employee</Th>
                  <Th>Team</Th>
                  <Th>Category</Th>
                  <Th align="right">Amount</Th>
                  <Th>Description</Th>
                  <Th>Related lead</Th>
                  <Th>Reference</Th>
                  <Th>Created</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <Td>{formatDate(r.date)}</Td>
                    <Td className="font-medium">{r.employee.name}</Td>
                    <Td className="text-slate-600">{r.team?.name ?? "—"}</Td>
                    <Td>
                      <span className="mr-1.5">{r.category.name}</span>
                      {r.countsTowardTarget ? <Badge tone="green">Counts</Badge> : <Badge tone="amber">Pipeline</Badge>}
                    </Td>
                    <Td align="right"><MoneyCell value={r.amount} className={r.countsTowardTarget ? "font-semibold" : "text-slate-500"} /></Td>
                    <Td className="max-w-[220px] truncate text-slate-600" >{r.description ?? "—"}</Td>
                    <Td>{r.lead ? <a href={`/leads/${r.lead.id}`} className="text-brand-700 hover:underline">{r.lead.companyName}</a> : "—"}</Td>
                    <Td className="text-slate-600">{r.referenceNo ?? "—"}</Td>
                    <Td className="text-xs text-slate-500">
                      {r.createdByName ?? "—"}
                      <br />
                      {formatDateTime(r.createdAt)}
                      {r.updatedAt !== r.createdAt && <span className="block text-amber-600">edited {formatDateTime(r.updatedAt)}</span>}
                    </Td>
                    <Td>
                      {canEdit(r) && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit"
                            onClick={() => setEditing({ id: r.id, date: r.date, employeeId: r.employeeId, categoryId: r.categoryId, amount: r.amount, description: r.description, leadId: r.leadId, referenceNo: r.referenceNo, notes: r.notes })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Void" onClick={() => voidEntry(r)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <AchievementFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} editing={editing} />
      {reason.element}
    </>
  );
}
