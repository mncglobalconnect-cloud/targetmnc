"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Alert, Button, Checkbox, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { useReasonPrompt } from "@/components/shared";
import { api, ApiClientError, LEAD_STATUS_META, LEAD_STATUSES, newIdempotencyKey, refreshAll, useDraft } from "@/lib/client";

interface Duplicate {
  id: string;
  companyName: string;
  phone: string;
  email: string | null;
  ownerName: string;
  leadDate: string;
  status: string;
  matchedOn: string[];
  exact: boolean;
}

interface Draft {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  altPhone: string;
  website: string;
  industry: string;
  source: string;
  estimatedValue: string;
  followUpDate: string;
  status: string;
  notes: string;
  leadDate: string;
  ownerId: string;
}

const SOURCES = ["Cold call", "Referral", "Website", "Walk-in", "Exhibition", "Social media", "Email campaign", "Partner", "Other"];

/** defaultOwnerId preselects the lead owner (e.g. from a Daily Progress row) and uses the selected business date. */
export function LeadFormDialog({ open, onOpenChange, onCreated, defaultOwnerId }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void; defaultOwnerId?: string | null }) {
  const { meta, date, isEmployee } = useApp();
  const initial: Draft = {
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    altPhone: "",
    website: "",
    industry: "",
    source: "",
    estimatedValue: "",
    followUpDate: "",
    status: "NEW",
    notes: "",
    leadDate: date > meta.today ? meta.today : date,
    ownerId: meta.user.employeeId ?? "",
  };
  const [form, setForm, clearDraft] = useDraft<Draft>("lead", initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<Duplicate[]>([]);
  const [confirmDup, setConfirmDup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const reason = useReasonPrompt();

  useEffect(() => {
    if (open && defaultOwnerId) setForm((f) => ({ ...f, leadDate: date > meta.today ? meta.today : date, ownerId: defaultOwnerId }));
    else if (open && !form.companyName) setForm((f) => ({ ...f, leadDate: date > meta.today ? meta.today : date, ownerId: f.ownerId || meta.user.employeeId || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultOwnerId]);

  // Live duplicate detection (debounced) on normalized company, email and phone.
  useEffect(() => {
    if (!open) return;
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (form.companyName.trim().length < 2 && phoneDigits.length < 7 && !form.email.includes("@")) {
      setDups([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<{ duplicates: Duplicate[] }>("/api/leads/check-duplicates", { body: { companyName: form.companyName, email: form.email || null, phone: form.phone } });
        setDups(res.duplicates);
        setConfirmDup(false);
      } catch {
        /* non-blocking */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [open, form.companyName, form.email, form.phone]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.companyName.trim().length < 2) e.companyName = "Company name is required";
    const digits = form.phone.replace(/\D/g, "");
    if (!form.phone.trim()) e.phone = "Contact phone number is required";
    else if (digits.length < 7 || !/^[+()\-\s\d]+$/.test(form.phone)) e.phone = "Enter a valid phone number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email";
    if (!form.ownerId) e.ownerId = "Select the lead owner";
    if (!form.leadDate) e.leadDate = "Lead date is required";
    else if (form.leadDate > meta.today) e.leadDate = "Lead date cannot be in the future";
    if (form.estimatedValue && !/^\d+(\.\d{1,2})?$/.test(form.estimatedValue.replace(/,/g, ""))) e.estimatedValue = "Enter a valid amount";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (withReason?: string) => {
    if (!validate()) return;
    if (dups.length && !confirmDup) {
      toast.warning("Possible duplicate found — review it and confirm this is a different prospect.");
      return;
    }
    setSaving(true);
    try {
      const created = await api<{ id: string }>("/api/leads", {
        body: {
          ...form,
          estimatedValue: form.estimatedValue ? form.estimatedValue.replace(/,/g, "") : null,
          followUpDate: form.followUpDate || null,
          confirmDuplicate: confirmDup,
          reason: withReason ?? null,
          idempotencyKey: idemKey,
        },
      });
      toast.success(`Lead "${form.companyName}" added`, { description: "Counted once toward the lead target for its creation date." });
      clearDraft({ ...initial, ownerId: form.ownerId, leadDate: form.leadDate });
      setIdemKey(newIdempotencyKey());
      setDups([]);
      await refreshAll();
      onOpenChange(false);
      onCreated?.(created.id);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return submit(r);
      } else if (err instanceof ApiClientError && err.status === 409 && (err.details as { duplicates?: Duplicate[] })?.duplicates) {
        setDups((err.details as { duplicates: Duplicate[] }).duplicates);
        toast.warning(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Could not save lead");
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
        size="lg"
        title="Add new lead"
        description="Required: company name, lead date, owner and contact phone."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => submit()} disabled={dups.length > 0 && !confirmDup}>
              Save lead
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
          <Field label="Company name" required error={errors.companyName} className="sm:col-span-2">
            <Input value={form.companyName} onChange={set("companyName")} placeholder="XYZ Pvt. Ltd." invalid={!!errors.companyName} autoFocus maxLength={200} />
          </Field>
          <Field label="Contact phone" required error={errors.phone}>
            <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="98765 43210" invalid={!!errors.phone} maxLength={25} />
          </Field>
          <Field label="Contact person">
            <Input value={form.contactPerson} onChange={set("contactPerson")} maxLength={120} />
          </Field>
          <Field label="Business email" error={errors.email}>
            <Input type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" invalid={!!errors.email} maxLength={200} />
          </Field>
          <Field label="Alternate phone">
            <Input type="tel" value={form.altPhone} onChange={set("altPhone")} maxLength={25} />
          </Field>

          {dups.length > 0 && (
            <div className="sm:col-span-2">
              <Alert tone="amber" title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {dups.length} possible duplicate{dups.length > 1 ? "s" : ""}</span>}>
                <ul className="mb-2 space-y-1">
                  {dups.map((d) => (
                    <li key={d.id}>
                      <Link href={`/leads/${d.id}`} className="font-medium underline" target="_blank">
                        {d.companyName}
                      </Link>{" "}
                      — {d.phone}
                      {d.email ? `, ${d.email}` : ""} · owner {d.ownerName} · {d.leadDate} · matched on <b>{d.matchedOn.join(", ")}</b>
                    </li>
                  ))}
                </ul>
                <Checkbox checked={confirmDup} onChange={setConfirmDup} label="This is a different prospect — save it anyway" />
              </Alert>
            </div>
          )}

          <Field label="Lead date" required error={errors.leadDate}>
            <Input type="date" max={meta.today} value={form.leadDate} onChange={set("leadDate")} invalid={!!errors.leadDate} />
          </Field>
          <Field label="Lead owner" required error={errors.ownerId}>
            <Select value={form.ownerId} onChange={set("ownerId")} disabled={isEmployee} invalid={!!errors.ownerId}>
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Company website">
            <Input value={form.website} onChange={set("website")} placeholder="www.company.com" maxLength={300} />
          </Field>
          <Field label="Industry">
            <Input value={form.industry} onChange={set("industry")} placeholder="Manufacturing" maxLength={80} />
          </Field>
          <Field label="Lead source">
            <Select value={form.source} onChange={set("source")}>
              <option value="">Select source…</option>
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Lead status">
            <Select value={form.status} onChange={set("status")}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated deal value (₹)" error={errors.estimatedValue}>
            <Input inputMode="decimal" value={form.estimatedValue} onChange={set("estimatedValue")} invalid={!!errors.estimatedValue} />
          </Field>
          <Field label="Follow-up date">
            <Input type="date" value={form.followUpDate} onChange={set("followUpDate")} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={set("notes")} maxLength={2000} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Dialog>
      {reason.element}
    </>
  );
}
