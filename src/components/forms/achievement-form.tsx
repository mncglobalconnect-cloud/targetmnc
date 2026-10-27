"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { useReasonPrompt } from "@/components/shared";
import { api, ApiClientError, newIdempotencyKey, refreshAll, useApi, useDraft } from "@/lib/client";

interface Draft {
  date: string;
  employeeId: string;
  categoryId: string;
  amount: string;
  description: string;
  leadId: string;
  referenceNo: string;
  notes: string;
}

export interface AchievementEditing {
  id: string;
  date: string;
  employeeId: string;
  categoryId: string;
  amount: string;
  description: string | null;
  leadId: string | null;
  referenceNo: string | null;
  notes: string | null;
}

/** defaultEmployeeId preselects the employee (e.g. from a Daily Progress row) and uses the selected business date. */
export function AchievementFormDialog({ open, onOpenChange, editing: editingProp, defaultEmployeeId }: { open: boolean; onOpenChange: (v: boolean) => void; editing?: AchievementEditing | null; defaultEmployeeId?: string | null }) {
  const { meta, date, isEmployee } = useApp();
  // An entry chosen from the "already recorded" list switches this dialog into edit mode.
  const [picked, setPicked] = useState<AchievementEditing | null>(null);
  const editing = editingProp ?? picked;
  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);
  const initial: Draft = {
    date,
    employeeId: meta.user.employeeId ?? "",
    categoryId: meta.categories.find((c) => c.countsTowardTarget)?.id ?? "",
    amount: "",
    description: "",
    leadId: "",
    referenceNo: "",
    notes: "",
  };
  const [form, setForm, clearDraft] = useDraft<Draft>(editing ? `achievement-edit-${editing.id}` : "achievement", initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const reason = useReasonPrompt();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        date: editing.date,
        employeeId: editing.employeeId,
        categoryId: editing.categoryId,
        amount: String(Number(editing.amount)),
        description: editing.description ?? "",
        leadId: editing.leadId ?? "",
        referenceNo: editing.referenceNo ?? "",
        notes: editing.notes ?? "",
      });
    } else if (defaultEmployeeId) {
      setForm((f) => ({ ...f, date: date > meta.today ? meta.today : date, employeeId: defaultEmployeeId }));
    } else if (!form.amount) {
      setForm((f) => ({ ...f, date: f.date || date, employeeId: f.employeeId || meta.user.employeeId || "" }));
    }
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, defaultEmployeeId]);

  const leads = useApi<{ rows: { id: string; companyName: string }[] }>(open && form.employeeId ? `/api/leads?ownerId=${form.employeeId}&pageSize=100&sort=createdAt` : null);
  // Amounts already saved for this person and date (each save adds a separate entry).
  const recorded = useApi<{ entries: (AchievementEditing & { countsTowardTarget: boolean; createdAt: string; category: { name: string } })[] }>(
    open && !editing && form.employeeId && form.date ? `/api/reports/detail?date=${form.date}&employeeId=${form.employeeId}` : null,
  );
  const recordedTotal = (recorded.data?.entries ?? []).filter((e) => e.countsTowardTarget).reduce((s, e) => s + Number(e.amount), 0);
  const category = meta.categories.find((c) => c.id === form.categoryId);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.date) e.date = "Date is required";
    else if (form.date > meta.today) e.date = "Cannot record achievements for a future date";
    if (!form.employeeId) e.employeeId = "Select an employee";
    if (!form.categoryId) e.categoryId = "Select a category";
    const amt = Number(form.amount.replace(/,/g, ""));
    if (!form.amount || !Number.isFinite(amt) || amt <= 0) e.amount = "Enter an amount greater than zero";
    else if (!/^\d+(\.\d{1,2})?$/.test(form.amount.replace(/,/g, ""))) e.amount = "Up to 2 decimal places";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (withReason?: string) => {
    if (!validate()) return;
    setSaving(true);
    const payload = {
      date: form.date,
      employeeId: form.employeeId,
      categoryId: form.categoryId,
      amount: form.amount.replace(/,/g, ""),
      description: form.description,
      leadId: form.leadId || null,
      referenceNo: form.referenceNo,
      notes: form.notes,
      reason: withReason ?? null,
    };
    try {
      if (editing) {
        const { date: _d, employeeId: _e, ...patch } = payload;
        await api(`/api/achievements/${editing.id}`, { method: "PATCH", body: patch });
        toast.success("Achievement updated");
      } else {
        await api("/api/achievements", { body: { ...payload, idempotencyKey: idemKey } });
        toast.success(`Achievement of ₹${Number(payload.amount).toLocaleString("en-IN")} recorded`, { description: category?.countsTowardTarget ? "Counts toward the daily target." : "Recorded as pipeline — does not count toward the target." });
      }
      clearDraft({ ...initial, date: form.date, employeeId: form.employeeId, categoryId: form.categoryId });
      setPicked(null);
      setIdemKey(newIdempotencyKey());
      await refreshAll();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return submit(r);
      } else {
        toast.error(err instanceof Error ? err.message : "Could not save");
      }
    } finally {
      setSaving(false);
    }
  };

  const employees = meta.employees.filter((e) => e.active && e.role !== "SUPER_ADMIN");
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? "Edit achievement" : "Record achievement"}
        description={editing ? "Change the saved amount or details. The day's total is recalculated automatically." : "Each save adds a new amount to the day's total. To change an amount already saved, use Edit below."}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => submit()}>
              {editing ? "Save changes" : "Save achievement"}
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Date" required error={errors.date}>
            <Input type="date" max={meta.today} value={form.date} onChange={set("date")} disabled={!!editing} invalid={!!errors.date} />
          </Field>
          <Field label="Employee" required error={errors.employeeId}>
            <Select value={form.employeeId} onChange={set("employeeId")} disabled={isEmployee || !!editing} invalid={!!errors.employeeId}>
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </Select>
          </Field>
          {editing && picked && (
            <Alert tone="blue" className="sm:col-span-2">
              Editing a saved entry.{" "}
              <button type="button" className="font-medium underline" onClick={() => { setPicked(null); setForm({ ...initial, date: form.date, employeeId: form.employeeId }); }}>
                Add a new amount instead
              </button>
            </Alert>
          )}
          {!editing && (recorded.data?.entries.length ?? 0) > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Already recorded on this date: <span className="tabular font-semibold text-navy">₹{recordedTotal.toLocaleString("en-IN")}</span> ({recorded.data!.entries.length} entr{recorded.data!.entries.length === 1 ? "y" : "ies"}). A new amount is added on top.
              </p>
              <ul className="max-h-36 space-y-1 overflow-y-auto">
                {recorded.data!.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="tabular font-medium">₹{Number(e.amount).toLocaleString("en-IN")}</span>{" "}
                      <span className="text-xs text-slate-500">{e.category.name}{e.description ? ` · ${e.description}` : ""}{!e.countsTowardTarget ? " · not counted" : ""}</span>
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPicked({ id: e.id, date: form.date, employeeId: form.employeeId, categoryId: e.categoryId, amount: String(e.amount), description: e.description, leadId: e.leadId, referenceNo: e.referenceNo, notes: e.notes })}>
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label={editing ? "Amount (₹)" : "New amount to add (₹)"} required error={errors.amount}>
            <Input inputMode="decimal" placeholder="10000" value={form.amount} onChange={set("amount")} invalid={!!errors.amount} autoFocus />
          </Field>
          <Field label="Category" required error={errors.categoryId}>
            <Select value={form.categoryId} onChange={set("categoryId")} invalid={!!errors.categoryId}>
              <option value="">Select category…</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {category && !category.countsTowardTarget && (
            <Alert tone="amber" className="sm:col-span-2">
              This category is pipeline / projected value. It is recorded for reporting but <b>does not count</b> toward the monetary target.
            </Alert>
          )}
          <Field label="Related lead" className="sm:col-span-2">
            <Select value={form.leadId} onChange={set("leadId")}>
              <option value="">None</option>
              {leads.data?.rows.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={set("description")} placeholder="e.g. Invoice for annual contract" maxLength={500} />
          </Field>
          <Field label="Reference number">
            <Input value={form.referenceNo} onChange={set("referenceNo")} placeholder="Invoice / PO number" maxLength={100} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={set("notes")} maxLength={1000} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Dialog>
      {reason.element}
    </>
  );
}
