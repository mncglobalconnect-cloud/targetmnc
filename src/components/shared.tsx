"use client";
import { useRef, useState } from "react";
import { Badge, Button, Card, Dialog, Field, Progress, Textarea } from "@/components/ui";
import { LEAD_STATUS_META, STATUS_META } from "@/lib/client";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-navy sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function LeadStatusBadge({ status }: { status: string }) {
  const m = LEAD_STATUS_META[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function KpiCard({ label, value, sub, icon, pct, tone = "blue" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; pct?: number | null; tone?: "blue" | "green" | "amber" | "violet" }) {
  const iconTone = { blue: "bg-brand-50 text-brand-600", green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", violet: "bg-violet-50 text-violet-600" }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="tabular mt-1.5 truncate text-xl font-semibold text-navy sm:text-2xl">{value}</p>
        </div>
        {icon && <div className={cn("rounded-lg p-2", iconTone)}>{icon}</div>}
      </div>
      {pct !== undefined && <Progress value={pct} className="mt-3" />}
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

/**
 * Promise-based reason prompt. The API answers 428 when a locked day is being corrected; callers
 * catch that, ask for a reason here, and retry with it.
 */
export function useReasonPrompt() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("Correction reason required");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const prompt = (t?: string) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setTitle(t ?? "Correction reason required");
      setReason("");
      setOpen(true);
    });
  const close = (v: string | null) => {
    setOpen(false);
    resolver.current?.(v);
    resolver.current = null;
  };

  const element = (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close(null)}
      title={title}
      description="This change affects a submitted or locked report. The reason is stored in the audit log."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button disabled={reason.trim().length < 5} onClick={() => close(reason.trim())}>
            Confirm
          </Button>
        </>
      }
    >
      <Field label="Reason" required hint="Minimum 5 characters">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Invoice amount corrected after finance review" />
      </Field>
    </Dialog>
  );
  return { prompt, element };
}

export function MoneyCell({ value, className }: { value: string | number; className?: string }) {
  const n = Number(value);
  return <span className={cn("tabular", className)}>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n)}</span>;
}

export function PctCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const tone = value >= 100 ? "text-emerald-600" : value >= 70 ? "text-brand-700" : value >= 40 ? "text-amber-600" : "text-red-600";
  return <span className={cn("tabular font-medium", tone)}>{value.toFixed(value % 1 === 0 ? 0 : 2)}%</span>;
}
