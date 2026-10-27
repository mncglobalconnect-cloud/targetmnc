"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Gauge, Pencil, Plus, ShieldCheck, Tags, Trash2, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, ErrorState, Field, Input, Skeleton, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { PageHeader } from "@/components/shared";
import { api, refreshAll, useApi } from "@/lib/client";
import { formatDate } from "@/lib/format";
import type { AppSettings } from "@/lib/settings-schema";

interface Category {
  id: string;
  code: string;
  name: string;
  countsTowardTarget: boolean;
  active: boolean;
  sortOrder: number;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function CategoryDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Category | null }) {
  const [form, setForm] = useState({ code: "", name: "", countsTowardTarget: true, active: true, sortOrder: "0" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm(editing ? { ...editing, sortOrder: String(editing.sortOrder) } : { code: "", name: "", countsTowardTarget: true, active: true, sortOrder: "0" });
  }, [open, editing]);
  const save = async () => {
    if (!/^[A-Za-z0-9_]{2,40}$/.test(form.code)) return toast.error("Code: 2–40 letters, digits or underscores");
    if (form.name.trim().length < 2) return toast.error("Enter a category name");
    setSaving(true);
    try {
      await api("/api/settings/categories", { body: { id: editing?.id, code: form.code, name: form.name, countsTowardTarget: form.countsTowardTarget, active: form.active, sortOrder: Number(form.sortOrder) || 0 } });
      toast.success(editing ? "Category updated" : "Category created");
      await refreshAll();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit achievement category" : "New achievement category"}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={saving} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={!!editing} placeholder="SALE_CLOSED" />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <Checkbox
            checked={form.countsTowardTarget}
            onChange={(v) => setForm({ ...form, countsTowardTarget: v })}
            label="Counts toward the monetary target"
            description="Tick for completed business (closed sales, payments). Leave unticked for quotations, projections and pipeline."
          />
          <Checkbox checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Active (available for new entries)" />
        </div>
        {editing && editing.countsTowardTarget !== form.countsTowardTarget && (
          <Alert tone="amber" className="sm:col-span-2">Existing entries keep the rule frozen when they were saved — this change applies only to new entries.</Alert>
        )}
      </div>
    </Dialog>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useApp();
  const { data, error, isLoading, mutate } = useApi<{ settings: AppSettings; categories: Category[] }>("/api/settings");
  const [s, setS] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const [maxTarget, setMaxTarget] = useState("");
  const [catDialog, setCatDialog] = useState<{ open: boolean; editing: Category | null }>({ open: false, editing: null });

  useEffect(() => {
    if (data) {
      setS(data.settings);
      setMaxTarget(data.settings.permissions.managerMaxDailyTarget === null ? "" : String(data.settings.permissions.managerMaxDailyTarget));
    }
  }, [data]);

  if (error) return <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>;
  if (isLoading || !data || !s) return <Skeleton className="h-96 w-full" />;
  const ro = !isAdmin;

  const save = async () => {
    if (maxTarget && !/^\d+(\.\d{1,2})?$/.test(maxTarget)) return toast.error("Manager limit must be a number");
    if (s.workdayEnd <= s.workdayStart) return toast.error("Workday end must be after start");
    setSaving(true);
    try {
      const body: AppSettings = { ...s, permissions: { ...s.permissions, managerMaxDailyTarget: maxTarget ? Number(maxTarget) : null } };
      await api("/api/settings", { method: "PUT", body });
      toast.success("Settings saved", { description: "New rules apply immediately to dashboards and validation." });
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const addHoliday = () => {
    if (!holiday.date || !holiday.name.trim()) return toast.error("Enter a holiday date and name");
    if (s.holidays.some((h) => h.date === holiday.date)) return toast.error("That date is already a holiday");
    setS({ ...s, holidays: [...s.holidays, { date: holiday.date, name: holiday.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) });
    setHoliday({ date: "", name: "" });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business calendar, status rules, lead rules and permissions."
        actions={isAdmin && <Button loading={saving} onClick={save}>Save settings</Button>}
      />
      {ro && <Alert tone="blue" className="mb-6">You can view these rules. Only a Super Admin can change them.</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand-600" /> Business calendar</span>} />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Timezone" hint="IANA name">
                <Input value={s.timezone} disabled={ro} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
              </Field>
              <Field label="Workday start">
                <Input type="time" value={s.workdayStart} disabled={ro} onChange={(e) => setS({ ...s, workdayStart: e.target.value })} />
              </Field>
              <Field label="Workday end">
                <Input type="time" value={s.workdayEnd} disabled={ro} onChange={(e) => setS({ ...s, workdayEnd: e.target.value })} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-700">Weekend (non-working) days</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {DAYS.map((d, i) => (
                  <Checkbox key={d} label={d} disabled={ro} checked={s.weekendDays.includes(i)} onChange={(v) => setS({ ...s, weekendDays: v ? [...s.weekendDays, i].sort() : s.weekendDays.filter((x) => x !== i) })} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-700">Holidays</p>
              {s.holidays.length === 0 ? (
                <p className="text-xs text-slate-500">No holidays configured.</p>
              ) : (
                <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {s.holidays.map((h) => (
                    <li key={h.date} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span><span className="tabular mr-3 text-slate-500">{formatDate(h.date)}</span>{h.name}</span>
                      {!ro && (
                        <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${h.name}`} onClick={() => setS({ ...s, holidays: s.holidays.filter((x) => x.date !== h.date) })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!ro && (
                <div className="flex flex-wrap gap-2">
                  <Input type="date" className="w-40" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} aria-label="Holiday date" />
                  <Input className="min-w-0 flex-1" placeholder="Holiday name (e.g. Diwali)" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} aria-label="Holiday name" />
                  <Button variant="outline" onClick={addHoliday}><Plus className="h-4 w-4" /> Add</Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><Gauge className="h-4 w-4 text-brand-600" /> Status thresholds</span>} />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="On-track tolerance (%)" hint="Allowed shortfall vs. expected progress">
                <Input type="number" min={0} max={100} value={s.status.onTrackTolerancePct} disabled={ro} onChange={(e) => setS({ ...s, status: { ...s.status, onTrackTolerancePct: Number(e.target.value) } })} />
              </Field>
              <Field label="Grace period (minutes)" hint="No one is flagged At Risk before this">
                <Input type="number" min={0} max={720} value={s.status.graceMinutes} disabled={ro} onChange={(e) => setS({ ...s, status: { ...s.status, graceMinutes: Number(e.target.value) } })} />
              </Field>
            </div>
            <Alert tone="blue" title="How statuses are computed">
              Expected progress rises linearly from 0% at workday start ({s.workdayStart}) to 100% at workday end ({s.workdayEnd}). An employee is <b>At Risk</b> when their
              weakest metric (money or leads) is below expected × (1 − {s.status.onTrackTolerancePct}%), but never during the first {s.status.graceMinutes} minutes of the day.
              <b> Completed</b> = every target met; <b>Overachieved</b> = met and exceeded; <b>Not Started</b> = nothing recorded. Past or locked days show <b>Partially Achieved</b> or <b>Missed</b>.
            </Alert>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-brand-600" /> Lead rules</span>} />
          <CardBody className="space-y-4">
            <Alert tone="blue" title="Attribution policy: original creator">
              Each lead counts once, for the employee who created it, on its lead (creation) date. Transferring ownership changes who works the lead but not who is credited.
              Managers can explicitly change credit or lead date with a reason — this is audited. Follow-ups and edits never create additional lead counts; merged duplicates stop counting;
              imported leads count only after validation.
            </Alert>
            <Checkbox
              disabled={ro}
              checked={s.leads.blockExactDuplicates}
              onChange={(v) => setS({ ...s, leads: { ...s.leads, blockExactDuplicates: v } })}
              label="Block exact duplicates"
              description="Reject a new lead whose normalized phone or email already exists (otherwise users see a warning and must confirm)."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Permissions</span>} />
          <CardBody className="space-y-4">
            <Checkbox disabled={ro} checked={s.permissions.employeesCanRecordAchievements} onChange={(v) => setS({ ...s, permissions: { ...s.permissions, employeesCanRecordAchievements: v } })} label="Employees can record their own achievements" />
            <Checkbox disabled={ro} checked={s.permissions.employeesCanEditOwnSameDay} onChange={(v) => setS({ ...s, permissions: { ...s.permissions, employeesCanEditOwnSameDay: v } })} label="Employees can edit their own entries on the same day" description="Before the day is submitted. Later corrections go through a manager." />
            <Checkbox disabled={ro} checked={s.permissions.managersCanAssignTargets} onChange={(v) => setS({ ...s, permissions: { ...s.permissions, managersCanAssignTargets: v } })} label="Managers can assign targets to their teams" />
            <Field label="Manager limit — max daily target per employee (₹)" hint="Leave empty for no limit. Super Admins are not limited.">
              <Input inputMode="decimal" value={maxTarget} disabled={ro} onChange={(e) => setMaxTarget(e.target.value)} placeholder="No limit" />
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={<span className="flex items-center gap-1.5"><Tags className="h-4 w-4 text-brand-600" /> Achievement categories</span>}
          description="Only categories marked “counts” add to the monetary target — this separates completed business from quotations and pipeline. Rule changes apply to new entries only."
          action={isAdmin && <Button size="sm" onClick={() => setCatDialog({ open: true, editing: null })}><Plus className="h-3.5 w-3.5" /> New category</Button>}
        />
        <Table>
          <thead>
            <tr>
              <Th>Order</Th><Th>Code</Th><Th>Name</Th><Th>Counts toward target</Th><Th>Status</Th><Th />
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.id}>
                <Td className="text-slate-400">{c.sortOrder}</Td>
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td>{c.name}</Td>
                <Td>{c.countsTowardTarget ? <Badge tone="green">Counts</Badge> : <Badge tone="amber">Pipeline — not counted</Badge>}</Td>
                <Td>{c.active ? <Badge tone="blue">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td align="right">
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => setCatDialog({ open: true, editing: c })} aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <CategoryDialog open={catDialog.open} editing={catDialog.editing} onOpenChange={(o) => setCatDialog((d) => ({ ...d, open: o }))} />
    </>
  );
}
