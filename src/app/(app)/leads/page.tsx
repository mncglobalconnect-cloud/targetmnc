"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, GitMerge, Upload, UserPlus, XCircle } from "lucide-react";
import { useApp } from "@/components/app-context";
import { LeadStatusBadge, MoneyCell, PageHeader } from "@/components/shared";
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, Pagination, Select, Skeleton, Table, Td, Textarea, Th } from "@/components/ui";
import { api, ApiClientError, downloadUrl, LEAD_STATUS_META, LEAD_STATUSES, qs, refreshAll, useApi } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { csvToLeadRows } from "./csv";
import { addDays } from "@/lib/dates";

interface LeadRow {
  id: string;
  companyName: string;
  contactPerson: string | null;
  email: string | null;
  phone: string;
  status: string;
  leadDate: string;
  followUpDate: string | null;
  estimatedValue: string | null;
  validation: string;
  countsTowardTarget: boolean;
  source: string | null;
  owner: { id: string; name: string };
  creditedEmployee: { id: string; name: string };
  team: { id: string; name: string } | null;
}
type SortKey = "leadDate" | "companyName" | "status" | "estimatedValue" | "followUpDate" | "createdAt";

function LeadsInner() {
  const { meta, isEmployee, setQuickAdd, date } = useApp();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [validation, setValidation] = useState(params.get("validation") ?? "");
  const [followUpDue, setFollowUpDue] = useState(params.get("followUpDue") === "true");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const url = `/api/leads${qs({ q: debouncedQ, status, ownerId, teamId, from, to, validation, followUpDue: followUpDue ? "true" : undefined, sort: sort.key, dir: sort.dir, page, pageSize: 25 })}`;
  const list = useApi<{ total: number; page: number; pageSize: number; rows: LeadRow[] }>(url);
  const reset = () => setPage(1);
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const sorted = (key: SortKey) => (sort.key === key ? sort.dir : null);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedRows = list.data?.rows.filter((r) => selected.includes(r.id)) ?? [];
  const pendingSelected = selectedRows.filter((r) => r.validation === "PENDING_VALIDATION");

  const validate = async (action: "VALID" | "REJECTED") => {
    try {
      const res = await api<{ updated: number }>("/api/leads/validate", { body: { ids: pendingSelected.map((r) => r.id), action } });
      toast.success(`${res.updated} lead(s) ${action === "VALID" ? "validated — now counted" : "rejected"}`);
      setSelected([]);
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const today = meta.today;
  return (
    <>
      <PageHeader
        title="Lead management"
        description="Every lead is a unique prospect record, counted once toward the credited employee's target on its creation date."
        actions={
          <>
            <Button variant="outline" onClick={() => downloadUrl(`/api/export${qs({ format: "csv", dataset: "leads", from: from || addDays(to || today, -365), to: to || today })}`)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {!isEmployee && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
            )}
            <Button onClick={() => setQuickAdd("lead")}>
              <UserPlus className="h-4 w-4" /> Add lead
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-4 md:grid-cols-4 xl:grid-cols-8">
          <Field label="Search" className="col-span-2">
            <Input value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Company, contact, email or phone" />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="">All</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>)}
            </Select>
          </Field>
          {!isEmployee && (
            <Field label="Owner">
              <Select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); reset(); }}>
                <option value="">All</option>
                {meta.employees.filter((e) => e.role !== "SUPER_ADMIN").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
          )}
          {!isEmployee && (
            <Field label="Team">
              <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); reset(); }}>
                <option value="">All</option>
                {meta.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Created from">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          </Field>
          <Field label="Created to">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
          </Field>
          <Field label="Validation">
            <Select value={validation} onChange={(e) => { setValidation(e.target.value); reset(); }}>
              <option value="">All</option>
              <option value="VALID">Valid</option>
              <option value="PENDING_VALIDATION">Pending validation</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-2.5">
          <Checkbox checked={followUpDue} onChange={(v) => { setFollowUpDue(v); reset(); }} label="Follow-ups due" />
          <Button variant="ghost" size="sm" onClick={() => { setFrom(date); setTo(date); reset(); }}>Created on {formatDate(date)}</Button>
          {(q || status || ownerId || teamId || from || to || validation || followUpDue) && (
            <Button variant="ghost" size="sm" onClick={() => { setQ(""); setStatus(""); setOwnerId(""); setTeamId(""); setFrom(""); setTo(""); setValidation(""); setFollowUpDue(false); reset(); }}>
              Clear filters
            </Button>
          )}
          {!isEmployee && selected.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">{selected.length} selected</span>
              <Button size="sm" variant="secondary" disabled={selected.length < 2} onClick={() => setMergeOpen(true)}>
                <GitMerge className="h-3.5 w-3.5" /> Merge duplicates
              </Button>
              {pendingSelected.length > 0 && (
                <>
                  <Button size="sm" variant="success" onClick={() => validate("VALID")}><CheckCircle2 className="h-3.5 w-3.5" /> Validate {pendingSelected.length}</Button>
                  <Button size="sm" variant="outline" onClick={() => validate("REJECTED")}><XCircle className="h-3.5 w-3.5" /> Reject</Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            </div>
          )}
        </div>

        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => list.mutate()} />
        ) : !list.data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : list.data.rows.length === 0 ? (
          <EmptyState icon={<UserPlus className="h-5 w-5" />} title="No leads found" description="Try different filters, or add a new lead." action={<Button onClick={() => setQuickAdd("lead")}>Add lead</Button>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {!isEmployee && <Th className="w-8" />}
                  <Th onClick={() => toggleSort("companyName")} sorted={sorted("companyName")}>Company</Th>
                  <Th>Contact</Th>
                  <Th onClick={() => toggleSort("status")} sorted={sorted("status")}>Status</Th>
                  <Th onClick={() => toggleSort("leadDate")} sorted={sorted("leadDate")}>Lead date</Th>
                  <Th>Owner</Th>
                  <Th>Credited to</Th>
                  <Th align="right" onClick={() => toggleSort("estimatedValue")} sorted={sorted("estimatedValue")}>Est. value</Th>
                  <Th onClick={() => toggleSort("followUpDate")} sorted={sorted("followUpDate")}>Follow-up</Th>
                  <Th>Counts</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    {!isEmployee && (
                      <Td>
                        <input type="checkbox" aria-label={`Select ${l.companyName}`} className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={selected.includes(l.id)} onChange={() => toggle(l.id)} />
                      </Td>
                    )}
                    <Td>
                      <Link href={`/leads/${l.id}`} className="font-medium text-brand-700 hover:underline">{l.companyName}</Link>
                      {l.source && <span className="block text-[11px] text-slate-400">{l.source}</span>}
                    </Td>
                    <Td className="text-xs">
                      <span className="block text-navy">{l.contactPerson ?? "—"}</span>
                      <span className="block text-slate-500">{l.phone}{l.email ? ` · ${l.email}` : ""}</span>
                    </Td>
                    <Td><LeadStatusBadge status={l.status} /></Td>
                    <Td>{formatDate(l.leadDate)}</Td>
                    <Td>{l.owner.name}</Td>
                    <Td className={l.creditedEmployee.id !== l.owner.id ? "text-amber-700" : "text-slate-600"}>{l.creditedEmployee.name}</Td>
                    <Td align="right">{l.estimatedValue ? <MoneyCell value={l.estimatedValue} /> : "—"}</Td>
                    <Td className={l.followUpDate && l.followUpDate <= today && !["CONVERTED", "LOST"].includes(l.status) ? "font-medium text-red-600" : ""}>{l.followUpDate ? formatDate(l.followUpDate) : "—"}</Td>
                    <Td>
                      {l.validation === "PENDING_VALIDATION" ? <Badge tone="amber">Pending</Badge> : l.validation === "REJECTED" ? <Badge tone="red">Rejected</Badge> : l.countsTowardTarget ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <MergeDialog open={mergeOpen} onOpenChange={setMergeOpen} leads={selectedRows} onDone={() => setSelected([])} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

function MergeDialog({ open, onOpenChange, leads, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; leads: LeadRow[]; onDone: () => void }) {
  const [primaryId, setPrimaryId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      const oldest = [...leads].sort((a, b) => (a.leadDate < b.leadDate ? -1 : 1))[0];
      setPrimaryId(oldest?.id ?? "");
      setReason("");
    }
  }, [open, leads]);
  const submit = async () => {
    setSaving(true);
    try {
      await api("/api/leads/merge", { body: { primaryId, duplicateIds: leads.filter((l) => l.id !== primaryId).map((l) => l.id), reason } });
      toast.success("Leads merged. History preserved on the primary record.");
      onOpenChange(false);
      onDone();
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Merge failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Merge duplicate leads" description="Duplicates stop counting toward targets; their activities, assignments and linked achievements move to the primary lead." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={!primaryId || reason.trim().length < 5} onClick={submit}>Merge {leads.length - 1} into primary</Button></>}>
      <p className="mb-2 text-xs font-medium text-slate-700">Choose the primary (surviving) record</p>
      <div className="space-y-2">
        {leads.map((l) => (
          <label key={l.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${primaryId === l.id ? "border-brand-400 bg-brand-50" : "border-slate-200"}`}>
            <input type="radio" name="primary" className="mt-1" checked={primaryId === l.id} onChange={() => setPrimaryId(l.id)} />
            <span className="text-sm">
              <span className="font-medium">{l.companyName}</span> · {l.phone}{l.email ? ` · ${l.email}` : ""}
              <span className="block text-xs text-slate-500">Created {formatDate(l.leadDate)} · credited to {l.creditedEmployee.name} · {LEAD_STATUS_META[l.status]?.label}</span>
            </span>
          </label>
        ))}
      </div>
      <Field label="Reason" required className="mt-4">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Same company entered twice by two team members" />
      </Field>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { meta } = useApp();
  const [ownerId, setOwnerId] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; flaggedDuplicates: number; errors: { row: number; message: string }[] } | null>(null);
  useEffect(() => {
    if (open) {
      setRows([]);
      setResult(null);
      setFileName("");
    }
  }, [open]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return toast.error("File is too large (max 2 MB).");
    const parsed = csvToLeadRows(await f.text());
    setRows(parsed.rows);
    setUnmapped(parsed.unmapped);
    setFileName(f.name);
    if (!parsed.rows.length) toast.error("No data rows found in the file.");
  };
  const submit = async () => {
    setSaving(true);
    try {
      setResult(await api("/api/leads/import", { body: { ownerId, rows } }));
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import leads from spreadsheet" description="Save your sheet as CSV. Imported leads stay 'Pending validation' and don't affect targets until a manager validates them." size="lg"
      footer={result ? <Button onClick={() => onOpenChange(false)}>Done</Button> : <><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={!ownerId || !rows.length} onClick={submit}>Import {rows.length} row(s)</Button></>}>
      {result ? (
        <div className="space-y-3">
          <Alert tone="green" title={`${result.created} lead(s) imported as pending validation`}>{result.flaggedDuplicates > 0 && `${result.flaggedDuplicates} were flagged as possible duplicates (see notes on each lead).`}</Alert>
          {result.errors.length > 0 && (
            <Alert tone="amber" title={`${result.errors.length} row(s) skipped`}>
              <ul className="max-h-40 overflow-y-auto">{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Lead owner (credited employee)" required>
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Select employee…</option>
              {meta.employees.filter((e) => e.active && e.role !== "SUPER_ADMIN").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="CSV file" required hint="Columns: Company Name, Phone (required), Contact Person, Email, Website, Industry, Source, Notes, Lead Date (YYYY-MM-DD)">
            <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="py-1.5" />
          </Field>
          {fileName && <p className="text-xs text-slate-600">{fileName}: {rows.length} data row(s){unmapped.length ? ` · ignored columns: ${unmapped.join(", ")}` : ""}</p>}
          {rows.length > 0 && (
            <Table className="max-h-56 rounded-lg border">
              <thead><tr><Th>Company</Th><Th>Phone</Th><Th>Email</Th><Th>Contact</Th></tr></thead>
              <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}><Td>{r.companyName ?? <span className="text-red-600">missing</span>}</Td><Td>{r.phone ?? <span className="text-red-600">missing</span>}</Td><Td>{r.email ?? "—"}</Td><Td>{r.contactPerson ?? "—"}</Td></tr>)}</tbody>
            </Table>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}
