"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, User, UsersRound } from "lucide-react";
import { Alert, Button, Checkbox, Dialog, Field, Input, Select, Tabs } from "@/components/ui";
import { PageHeader } from "@/components/shared";
import { useApp } from "@/components/app-context";
import { api, refreshAll } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { IndividualTab, useCanAssign } from "./individual-tab";
import { TeamTab } from "./team-tab";
import { addDaysIso, daysBetween } from "./types";

export default function TargetsPage() {
  const { date, isEmployee } = useApp();
  const canAssign = useCanAssign();
  const [tab, setTab] = useState<"individual" | "team">("individual");
  const [copyOpen, setCopyOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Daily Targets"
        description={isEmployee ? `Your assigned targets for ${formatDate(date)}. Targets are set by your manager.` : `Assign and review individual and team targets for ${formatDate(date)}.`}
        actions={canAssign && (
          <Button variant="outline" onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" /> Copy targets
          </Button>
        )}
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "individual", label: "Individual Targets", icon: <User className="h-4 w-4" /> },
          { value: "team", label: "Team Targets", icon: <UsersRound className="h-4 w-4" /> },
        ]}
      />
      {tab === "individual" ? <IndividualTab /> : <TeamTab />}
      {canAssign && <CopyDialog open={copyOpen} onOpenChange={setCopyOpen} />}
    </>
  );
}

function CopyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { date, meta } = useApp();
  const [sourceDate, setSourceDate] = useState(date);
  const [from, setFrom] = useState(addDaysIso(date, 1));
  const [to, setTo] = useState(addDaysIso(date, 1));
  const [teamId, setTeamId] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [skipNonWorking, setSkipNonWorking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setSourceDate(date);
    setFrom(addDaysIso(date, 1));
    setTo(addDaysIso(date, 1));
    setResult(null);
    setError(null);
  } else if (!open && wasOpen) setWasOpen(false);

  const submit = async () => {
    setError(null);
    if (!sourceDate || !from || !to) return setError("All dates are required.");
    if (from > to) return setError("End date must be on or after the start date.");
    if (daysBetween(from, to) > 62) return setError("Copy is limited to 62 days at a time.");
    setSaving(true);
    try {
      const res = await api<{ created: number; updated: number; skipped: string[] }>("/api/targets/copy", {
        body: { sourceDate, from, to, teamId: teamId || null, overwrite, skipNonWorking },
      });
      setResult(res);
      toast.success(`Copied: ${res.created} created, ${res.updated} updated`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Copy targets"
      description="Copies individual allocations and team plans from one day to a date range. Locked days are skipped."
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={saving} onClick={submit}>Copy targets</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <Alert tone="green">{result.created} allocation(s) created, {result.updated} updated.</Alert>
          {result.skipped.length > 0 && (
            <Alert tone="amber" title="Skipped">
              <ul className="list-disc pl-4">{result.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </Alert>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {error && <Alert tone="red" className="sm:col-span-2">{error}</Alert>}
          <Field label="Copy from date" required className="sm:col-span-2">
            <Input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
          </Field>
          <Field label="Apply from" required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Apply to" required>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Team" className="sm:col-span-2" hint="Leave as all teams to copy everything you manage.">
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">All teams</option>
              {meta.teams.filter((t) => t.manageable).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox checked={skipNonWorking} onChange={setSkipNonWorking} label="Skip weekends and holidays" />
            <Checkbox checked={overwrite} onChange={setOverwrite} label="Overwrite existing targets on the destination dates" />
          </div>
        </div>
      )}
    </Dialog>
  );
}
