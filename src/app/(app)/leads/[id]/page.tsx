"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Building2, Globe, Mail, Pencil, Phone, Trash2, UserCog } from "lucide-react";
import { useApp } from "@/components/app-context";
import { LeadStatusBadge, MoneyCell, PageHeader, useReasonPrompt } from "@/components/shared";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { api, ApiClientError, LEAD_STATUS_META, LEAD_STATUSES, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatDateTime, formatINR, titleCase } from "@/lib/format";

interface LeadDetail {
  id: string;
  companyName: string;
  contactPerson: string | null;
  email: string | null;
  phone: string;
  altPhone: string | null;
  website: string | null;
  industry: string | null;
  source: string | null;
  estimatedValue: string | null;
  convertedValue: string | null;
  followUpDate: string | null;
  status: string;
  notes: string | null;
  leadDate: string;
  validation: string;
  countsTowardTarget: boolean;
  mergedIntoId: string | null;
  mergedInto: { id: string; companyName: string } | null;
  mergedFrom: { id: string; companyName: string; leadDate: string; phone: string }[];
  owner: { id: string; name: string; code: string };
  creditedEmployee: { id: string; name: string; code: string };
  team: { id: string; name: string } | null;
  createdAt: string;
  createdByName: string | null;
  activities: { id: string; type: string; description: string; createdAt: string; createdByName: string | null }[];
  assignments: { id: string; createdAt: string; reason: string | null; fromEmployee: { name: string } | null; toEmployee: { name: string } }[];
  achievements: { id: string; date: string; amount: string; countsTowardTarget: boolean; category: { name: string }; employee: { name: string } }[];
  duplicates: { id: string; companyName: string; phone: string; ownerName: string; leadDate: string; matchedOn: string[] }[];
}

const ACTIVITY_TONE: Record<string, "blue" | "green" | "amber" | "slate" | "violet" | "teal"> = {
  CALL: "teal", EMAIL: "blue", MEETING: "violet", FOLLOW_UP: "amber", NOTE: "slate", STATUS_CHANGE: "blue", OWNER_CHANGE: "amber", CREDIT_CHANGE: "amber", MERGE: "violet", CREATED: "green",
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { meta, isEmployee } = useApp();
  const { data: lead, error, mutate } = useApi<LeadDetail>(`/api/leads/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [activity, setActivity] = useState({ type: "CALL", description: "", nextFollowUpDate: "" });
  const [savingAct, setSavingAct] = useState(false);
  const reason = useReasonPrompt();

  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!lead) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  const readOnly = !!lead.mergedIntoId;

  const patch = async (body: Record<string, unknown>, success: string): Promise<boolean> => {
    try {
      await api(`/api/leads/${id}`, { method: "PATCH", body });
      toast.success(success);
      await Promise.all([mutate(), refreshAll()]);
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return patch({ ...body, reason: r }, success);
      } else toast.error(err instanceof Error ? err.message : "Update failed");
      return false;
    }
  };

  const addActivity = async () => {
    if (activity.description.trim().length < 2) return toast.error("Add a short description");
    setSavingAct(true);
    try {
      await api(`/api/leads/${id}/activities`, { body: { type: activity.type, description: activity.description, ...(activity.nextFollowUpDate ? { nextFollowUpDate: activity.nextFollowUpDate } : {}) } });
      toast.success("Activity logged (does not create a new lead)");
      setActivity({ type: "CALL", description: "", nextFollowUpDate: "" });
      await Promise.all([mutate(), refreshAll()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingAct(false);
    }
  };

  const remove = async () => {
    const r = await reason.prompt(`Delete lead "${lead.companyName}"?`);
    if (!r) return;
    try {
      await api(`/api/leads/${id}`, { method: "DELETE", body: { reason: r } });
      toast.success("Lead deleted");
      await refreshAll();
      router.push("/leads");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> All leads
      </Link>
      <PageHeader
        title={lead.companyName}
        description={<span className="flex flex-wrap items-center gap-2"><LeadStatusBadge status={lead.status} /> Created {formatDate(lead.leadDate)} by {lead.createdByName ?? "—"} · {lead.team?.name ?? "No team"}</span>}
        actions={
          !readOnly && (
            <>
              <Select value={lead.status} onChange={(e) => patch({ status: e.target.value }, `Status changed to ${LEAD_STATUS_META[e.target.value].label}`)} className="w-44" aria-label="Lead status">
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>)}
              </Select>
              <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
              {!isEmployee && <Button variant="outline" onClick={() => setTransferOpen(true)}><UserCog className="h-4 w-4" /> Owner & credit</Button>}
              {!isEmployee && <Button variant="ghost" onClick={remove} aria-label="Delete lead"><Trash2 className="h-4 w-4 text-red-500" /></Button>}
            </>
          )
        }
      />

      {readOnly && (
        <Alert tone="amber" className="mb-4" title="Merged record (read-only)">
          This lead was merged into <Link href={`/leads/${lead.mergedInto!.id}`} className="font-medium underline">{lead.mergedInto!.companyName}</Link> and no longer counts toward any target.
        </Alert>
      )}
      {lead.validation === "PENDING_VALIDATION" && <Alert tone="amber" className="mb-4" title="Pending validation">Imported lead — it will count toward the lead target only after a manager validates it.</Alert>}
      {lead.duplicates.length > 0 && !readOnly && (
        <Alert tone="amber" className="mb-4" title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Possible duplicates</span>}>
          {lead.duplicates.map((d) => (
            <span key={d.id} className="mr-3 inline-block">
              <Link className="font-medium underline" href={`/leads/${d.id}`}>{d.companyName}</Link> ({d.ownerName}, {formatDate(d.leadDate)}, matched on {d.matchedOn.join("/")})
            </span>
          ))}
          {!isEmployee && <span className="block pt-1 text-xs">Select them together in the lead directory to merge.</span>}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Lead information" />
            <CardBody className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Info icon={<Building2 className="h-4 w-4" />} label="Company" value={lead.companyName} />
              <Info label="Contact person" value={lead.contactPerson} />
              <Info icon={<Phone className="h-4 w-4" />} label="Phone" value={<a href={`tel:${lead.phone}`} className="text-brand-700 hover:underline">{lead.phone}</a>} />
              <Info label="Alternate phone" value={lead.altPhone} />
              <Info icon={<Mail className="h-4 w-4" />} label="Business email" value={lead.email && <a href={`mailto:${lead.email}`} className="text-brand-700 hover:underline">{lead.email}</a>} />
              <Info icon={<Globe className="h-4 w-4" />} label="Website" value={lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{lead.website}</a>} />
              <Info label="Industry" value={lead.industry} />
              <Info label="Lead source" value={lead.source} />
              <Info label="Estimated deal value" value={lead.estimatedValue && formatINR(lead.estimatedValue)} />
              <Info label="Converted value" value={lead.convertedValue && formatINR(lead.convertedValue)} />
              <Info label="Follow-up date" value={lead.followUpDate && formatDate(lead.followUpDate)} />
              <Info label="Lead date (counting date)" value={formatDate(lead.leadDate)} />
              <div className="sm:col-span-2"><Info label="Notes" value={lead.notes && <span className="whitespace-pre-wrap">{lead.notes}</span>} /></div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity & follow-ups" description="Calls, emails and follow-ups are logged against this lead — they never create a new lead count." />
            {!readOnly && (
              <div className="grid grid-cols-1 gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-6">
                <Field label="Type" className="sm:col-span-1">
                  <Select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })}>
                    {["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "NOTE"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                  </Select>
                </Field>
                <Field label="Description" className="sm:col-span-3">
                  <Input value={activity.description} onChange={(e) => setActivity({ ...activity, description: e.target.value })} placeholder="Discussed pricing, sending proposal" />
                </Field>
                <Field label="Next follow-up" className="sm:col-span-1">
                  <Input type="date" value={activity.nextFollowUpDate} onChange={(e) => setActivity({ ...activity, nextFollowUpDate: e.target.value })} />
                </Field>
                <div className="flex items-end sm:col-span-1">
                  <Button className="w-full" loading={savingAct} onClick={addActivity}>Log</Button>
                </div>
              </div>
            )}
            <CardBody>
              {lead.activities.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                  {lead.activities.map((a) => (
                    <li key={a.id}>
                      <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={ACTIVITY_TONE[a.type] ?? "slate"}>{titleCase(a.type)}</Badge>
                        <span className="text-xs text-slate-500">{formatDateTime(a.createdAt)} · {a.createdByName ?? "System"}</span>
                      </div>
                      <p className="mt-1 text-sm text-navy">{a.description}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Attribution" description="Who works the lead vs. who is credited for the lead target" />
            <CardBody className="space-y-3 text-sm">
              <Info label="Current owner" value={`${lead.owner.name} (${lead.owner.code})`} />
              <Info label="Target credit" value={`${lead.creditedEmployee.name} (${lead.creditedEmployee.code})`} />
              <Info label="Counts toward lead target" value={lead.countsTowardTarget && lead.validation === "VALID" && !lead.mergedIntoId ? <Badge tone="green">Yes — once, on {formatDate(lead.leadDate)}</Badge> : <Badge>No</Badge>} />
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Policy: the employee who created the lead keeps the target credit. Transferring ownership does not move the credit; only a manager can change credit explicitly, with a reason.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Ownership history" />
            <CardBody className="space-y-3 text-sm">
              {lead.assignments.map((a) => (
                <div key={a.id}>
                  <p>{a.fromEmployee ? <>{a.fromEmployee.name} → <b>{a.toEmployee.name}</b></> : <>Assigned to <b>{a.toEmployee.name}</b></>}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(a.createdAt)}{a.reason ? ` · ${a.reason}` : ""}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Linked achievements" />
            <CardBody className="space-y-2 text-sm">
              {lead.achievements.length === 0 ? <p className="text-xs text-slate-500">None recorded.</p> : lead.achievements.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <span>{formatDate(a.date)} · {a.employee.name}<span className="block text-xs text-slate-500">{a.category.name}{!a.countsTowardTarget && " (pipeline)"}</span></span>
                  <MoneyCell value={a.amount} className="font-medium" />
                </div>
              ))}
            </CardBody>
          </Card>
          {lead.mergedFrom.length > 0 && (
            <Card>
              <CardHeader title="Merged duplicates" />
              <CardBody className="space-y-2 text-sm">
                {lead.mergedFrom.map((m) => <p key={m.id}><Link href={`/leads/${m.id}`} className="text-brand-700 hover:underline">{m.companyName}</Link> <span className="text-xs text-slate-500">· {m.phone}</span></p>)}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <EditLeadDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} onSave={(b) => patch(b, "Lead updated")} />
      {!isEmployee && <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} lead={lead} employees={meta.employees.filter((e) => e.active && e.role !== "SUPER_ADMIN")} onSave={(b, msg) => patch(b, msg)} />}
      {reason.element}
    </>
  );
}

function Info({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</p>
      <div className="mt-0.5 text-navy">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

function EditLeadDialog({ open, onOpenChange, lead, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; lead: LeadDetail; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const fields = ["companyName", "contactPerson", "email", "phone", "altPhone", "website", "industry", "source", "estimatedValue", "convertedValue", "followUpDate", "notes"] as const;
  type F = Record<(typeof fields)[number], string>;
  const fromLead = (): F => Object.fromEntries(fields.map((k) => [k, (lead[k] ?? "").toString()])) as F;
  const [f, setF] = useState<F>(fromLead);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF(fromLead());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.companyName.trim().length < 2) return toast.error("Company name is required");
    if (f.phone.replace(/\D/g, "").length < 7) return toast.error("Enter a valid phone number");
    setSaving(true);
    const body: Record<string, unknown> = { ...f, estimatedValue: f.estimatedValue ? Number(f.estimatedValue).toFixed(2) : null, convertedValue: f.convertedValue ? Number(f.convertedValue).toFixed(2) : null, followUpDate: f.followUpDate || null };
    const ok = await onSave(body);
    setSaving(false);
    if (ok) onOpenChange(false);
  };
  const L: Record<string, string> = { companyName: "Company name", contactPerson: "Contact person", email: "Business email", phone: "Contact phone", altPhone: "Alternate phone", website: "Website", industry: "Industry", source: "Lead source", estimatedValue: "Estimated value (₹)", convertedValue: "Converted value (₹)", followUpDate: "Follow-up date", notes: "Notes" };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit lead" description="Editing never creates another lead count." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((k) => (
          <Field key={k} label={L[k]} required={k === "companyName" || k === "phone"} className={k === "notes" ? "sm:col-span-2" : ""}>
            {k === "notes" ? <Textarea value={f[k]} onChange={set(k)} /> : <Input type={k === "followUpDate" ? "date" : "text"} value={f[k]} onChange={set(k)} inputMode={k.endsWith("Value") ? "decimal" : undefined} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

function TransferDialog({ open, onOpenChange, lead, employees, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; lead: LeadDetail; employees: { id: string; name: string }[]; onSave: (b: Record<string, unknown>, msg: string) => Promise<boolean> }) {
  const [ownerId, setOwnerId] = useState(lead.owner.id);
  const [creditId, setCreditId] = useState(lead.creditedEmployee.id);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setOwnerId(lead.owner.id);
      setCreditId(lead.creditedEmployee.id);
      setReason("");
    }
  }, [open, lead]);
  const creditChange = creditId !== lead.creditedEmployee.id;
  const save = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { reason: reason || null };
    if (ownerId !== lead.owner.id) body.ownerId = ownerId;
    if (creditChange) body.creditedEmployeeId = creditId;
    const ok = await onSave(body, creditChange ? "Target credit changed" : "Lead transferred");
    setSaving(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Transfer ownership / change credit"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} disabled={(ownerId === lead.owner.id && !creditChange) || (creditChange && reason.trim().length < 5)} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Owner (works the lead)" hint="Transfers do not change target credit.">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        </Field>
        <Field label="Target credit (counted for)" hint="Changing credit moves the lead count to another employee for the lead date.">
          <Select value={creditId} onChange={(e) => setCreditId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        </Field>
        <Field label="Reason" required={creditChange}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={creditChange ? "Required for credit changes" : "Optional"} />
        </Field>
      </div>
    </Dialog>
  );
}
