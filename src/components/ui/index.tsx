"use client";
// Small shadcn-style component kit (Tailwind + Radix Dialog), kept in one module for consistency.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- Button ----------
type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg" | "icon";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  outline: "border border-slate-300 bg-white text-navy hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-navy",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-sm gap-2",
  icon: "h-9 w-9",
};
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      buttonVariants[variant],
      buttonSizes[size],
      className,
    )}
    {...props}
  >
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

// ---------- Card ----------
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-card", className)} {...props} />;
}
export function CardHeader({ className, title, description, action }: { className?: string; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-navy">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

// ---------- Form controls ----------
const control =
  "w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input ref={ref} className={cn(control, "h-9", invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/20", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, "min-h-[72px] py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(({ className, invalid, children, ...props }, ref) => (
  <select ref={ref} className={cn(control, "h-9 pr-8", invalid && "border-red-400", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, required, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("mb-1 block text-xs font-medium text-slate-700", className)} {...props}>
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

export function Field({ label, required, error, hint, children, className }: { label: string; required?: boolean; error?: string | null; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label required={required}>{label}</Label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, description }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; description?: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-navy">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

// ---------- Badge ----------
type Tone = "slate" | "blue" | "green" | "amber" | "red" | "violet" | "teal";
const tones: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};
export function Badge({ tone = "slate", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

// ---------- Dialog ----------
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-2xl focus:outline-none", w)}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-navy">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-slate-500">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg bg-slate-100 p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors", value === t.value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-navy")}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Table ----------
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("scrollbar-thin overflow-x-auto", className)}>
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ className, children, align = "left", onClick, sorted }: { className?: string; children?: React.ReactNode; align?: "left" | "right" | "center"; onClick?: () => void; sorted?: "asc" | "desc" | null }) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "sticky top-0 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
        align === "right" && "text-right",
        align === "center" && "text-center",
        onClick && "cursor-pointer select-none hover:text-navy",
        className,
      )}
    >
      {children}
      {sorted && <span className="ml-1">{sorted === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}
export function Td({ className, children, align = "left", colSpan }: { className?: string; children?: React.ReactNode; align?: "left" | "right" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("whitespace-nowrap border-b border-slate-100 px-3 py-2.5 text-navy", align === "right" && "tabular text-right", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

// ---------- States ----------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">{icon}</div>}
      <p className="text-sm font-semibold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Alert({ tone = "blue", title, children, className }: { tone?: "blue" | "amber" | "red" | "green"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const t = { blue: "border-brand-200 bg-brand-50 text-brand-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", t, className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-[13px] leading-relaxed")}>{children}</div>}
    </div>
  );
}

// ---------- Pagination ----------
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>
        {total === 0 ? "No records" : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString("en-IN")}`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2">
          Page {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------- Progress ----------
export function Progress({ value, className }: { value: number | null; className?: string }) {
  const v = value === null ? 0 : Math.min(100, Math.max(0, value));
  const color = value === null ? "bg-slate-300" : value >= 100 ? "bg-emerald-500" : value >= 70 ? "bg-brand-500" : value >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
    </div>
  );
}
