"use client";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, ShieldAlert } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, ErrorState, Field, Input, Pagination, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { PageHeader } from "@/components/shared";
import { qs, useApi } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
  actorName: string;
}

const ENTITY_TYPES = ["EmployeeTargetAllocation", "TeamTargetPlan", "AchievementEntry", "Lead", "DailyReportSubmission", "Employee", "Team", "Department", "AchievementCategory", "AppSetting", "GoogleSheetsIntegration", "SyncJob", "Export", "User"];

function actionTone(a: string): "red" | "amber" | "green" | "blue" | "slate" {
  if (a.includes("AFTER_LOCK") || a.includes("DELETED") || a.includes("VOIDED") || a.includes("REMOVED")) return "red";
  if (a.includes("REOPENED") || a.includes("CORRECT") || a.includes("TRANSFER") || a.includes("CREDIT") || a.includes("MERGED")) return "amber";
  if (a.includes("CREATED") || a.includes("ASSIGNED") || a.includes("LOCKED") || a.includes("VALIDATED")) return "green";
  if (a === "LOGIN" || a.includes("EXPORT")) return "slate";
  return "blue";
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (!isObj(before) || !isObj(after)) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {[["Before", before], ["After", after]].map(([label, v]) => (
          <div key={label as string}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label as string}</p>
            <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-relaxed">{v === null || v === undefined ? "—" : JSON.stringify(v, null, 2)}</pre>
          </div>
        ))}
      </div>
    );
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = (k: string) => JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  const sorted = [...keys.filter(changed), ...keys.filter((k) => !changed(k))];
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-500">
            <th className="px-3 py-1.5 font-semibold">Field</th>
            <th className="px-3 py-1.5 font-semibold">Before</th>
            <th className="px-3 py-1.5 font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((k) => {
            const c = changed(k);
            return (
              <tr key={k} className={cn("border-t border-slate-100", c && "bg-amber-50")}>
                <td className={cn("px-3 py-1 font-mono", c ? "font-semibold text-amber-800" : "text-slate-500")}>{k}</td>
                <td className={cn("max-w-[360px] break-all px-3 py-1 font-mono", c && "text-red-700")}>{show(before[k])}</td>
                <td className={cn("max-w-[360px] break-all px-3 py-1 font-mono", c && "text-emerald-700")}>{show(after[k])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditLogsPage() {
  const { isAdmin } = useApp();
  const [filters, setFilters] = useState({ action: "", entityType: "", from: "", to: "", q: "" });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q })), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filters]);

  const { data, error, isLoading, mutate } = useApi<{ total: number; page: number; pageSize: number; actions: string[]; rows: AuditRow[] }>(
    isAdmin ? `/api/audit-logs${qs({ ...filters, page, pageSize: 25 })}` : null,
  );
  if (!isAdmin) return <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Super Admin access required" description="Audit logs are visible to Super Admins only." />;

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <>
      <PageHeader title="Audit Logs" description="Every target change, achievement correction, lead transfer, report submission and export — with who, when and why." />
      <Card className="mb-6">
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Action">
            <Select value={filters.action} onChange={set("action")}>
              <option value="">All actions</option>
              {data?.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ").toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Entity">
            <Select value={filters.entityType} onChange={set("entityType")}>
              <option value="">All entities</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} onChange={set("from")} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} min={filters.from} onChange={set("to")} />
          </Field>
          <Field label="Search" hint="Action, reason or exact entity ID">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : data.rows.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="No audit entries match these filters" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-8" /><Th>Timestamp</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Reason</Th><Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <Td>{open === r.id ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</Td>
                      <Td className="text-xs">{formatDateTime(r.createdAt)}</Td>
                      <Td>{r.actorName}</Td>
                      <Td><Badge tone={actionTone(r.action)}>{r.action.replace(/_/g, " ").toLowerCase()}</Badge></Td>
                      <Td className="text-xs">
                        {r.entityType}
                        {r.entityId && <span className="block font-mono text-[10px] text-slate-400">{r.entityId}</span>}
                      </Td>
                      <Td className="max-w-[280px] truncate text-xs text-slate-600">{r.reason ?? "—"}</Td>
                      <Td className="text-xs text-slate-400">{r.ip ?? "—"}</Td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={7} className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
                          {r.reason && <p className="mb-3 text-sm"><span className="font-semibold">Reason:</span> {r.reason}</p>}
                          {r.before === null && r.after === null ? <p className="text-xs text-slate-500">No data snapshot for this event.</p> : <Diff before={r.before} after={r.after} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
