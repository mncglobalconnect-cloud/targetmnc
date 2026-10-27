"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Crown, IndianRupee, Lock, LockOpen, PartyPopper, Pencil, Target, Trash2, Trophy, UserPlus } from "lucide-react";
import { useApp } from "@/components/app-context";
import { AchievementFormDialog, type AchievementEditing } from "@/components/forms/achievement-form";
import { LeadFormDialog } from "@/components/forms/lead-form";
import { Confetti } from "@/components/confetti";
import { LeadStatusBadge, MoneyCell, PageHeader, PctCell, StatusBadge, useReasonPrompt } from "@/components/shared";
import { Alert, Badge, Button, Card, CardBody, Dialog, EmptyState, ErrorState, Field, Progress, Skeleton, Table, Td, Textarea, Th } from "@/components/ui";
import { api, ApiClientError, qs, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PerformanceResult, PerfRow, TeamAgg } from "@/lib/performance";

interface Submission {
  id: string;
  scopeKey: string;
  scope: string;
  teamId: string | null;
  status: "SUBMITTED" | "LOCKED" | "REOPENED";
  lockedAt: string | null;
  managerRemarks: string | null;
}
interface TeamInfo {
  id: string;
  name: string;
  leader: { id: string; name: string } | null;
  members: { id: string; name: string; code: string }[];
}

/** A team "reached" its goal when the money target is met (or the lead target, if it only has a lead target). */
function reached(t: TeamAgg) {
  if (Number(t.goalTarget) > 0) return Number(t.achieved) >= Number(t.goalTarget);
  return t.goalLeadTarget > 0 && t.leads >= t.goalLeadTarget;
}

export default function DailyProgressPage() {
  const { date, meta, isEmployee } = useApp();
  const perf = useApi<PerformanceResult>(`/api/performance${qs({ from: date, to: date, includeIdle: true })}`, { refreshInterval: 30_000 });
  const subs = useApi<Submission[]>(`/api/reports/submissions?date=${date}`);
  const teams = useApi<TeamInfo[]>("/api/teams");
  const [addAmountFor, setAddAmountFor] = useState<string | null>(null);
  const [addLeadFor, setAddLeadFor] = useState<string | null>(null);
  const [closing, setClosing] = useState<TeamAgg | null>(null);
  const [confettiShot, setConfettiShot] = useState(0);
  const reason = useReasonPrompt();
  const isFuture = date > meta.today;

  const teamLock = useMemo(() => {
    const m = new Map<string, Submission>();
    (subs.data ?? []).filter((s) => s.scope === "TEAM" && s.teamId).forEach((s) => m.set(s.teamId!, s));
    return m;
  }, [subs.data]);
  const isClosed = (teamId: string) => teamLock.get(teamId)?.status === "LOCKED";

  // Celebrate once per session for teams that closed the day on target.
  useEffect(() => {
    if (!perf.data || !subs.data) return;
    const winners = perf.data.byTeam.filter((t) => isClosed(t.teamId) && reached(t));
    const unseen = winners.filter((t) => {
      const k = `celebrated:${date}:${t.teamId}`;
      try {
        if (sessionStorage.getItem(k)) return false;
        sessionStorage.setItem(k, "1");
      } catch {
        /* storage unavailable: still celebrate */
      }
      return true;
    });
    if (unseen.length) setConfettiShot((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf.data, subs.data, date]);

  const reopen = async (t: TeamAgg) => {
    const why = await reason.prompt(`Reopen ${t.teamName} for ${formatDate(date)}?`);
    if (!why) return;
    try {
      await api("/api/reports/reopen", { body: { date, scopeKey: `TEAM:${t.teamId}`, reason: why } });
      toast.success(`${t.teamName} reopened — entries can be added again`);
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen");
    }
  };

  const loading = !perf.data || !subs.data || !teams.data;
  const rowsByTeam = new Map<string, PerfRow[]>();
  const individuals: PerfRow[] = [];
  (perf.data?.rows ?? []).forEach((r) => {
    if (r.teamId) rowsByTeam.set(r.teamId, [...(rowsByTeam.get(r.teamId) ?? []), r]);
    else if (r.hasAllocation || Number(r.achieved) > 0 || r.leads > 0) individuals.push(r);
  });
  const teamAggs = perf.data?.byTeam ?? [];
  const teamsWithoutTargets = (teams.data ?? []).filter((t) => t.members.length > 0 && !teamAggs.some((a) => a.teamId === t.id && (Number(a.goalTarget) > 0 || a.goalLeadTarget > 0)));

  return (
    <>
      <Confetti fire={confettiShot} />
      <PageHeader
        title="Daily Progress"
        description={`${formatDate(date)} — add each partial closing and new lead as it happens. Balances update instantly; close the team's day at the end.`}
        actions={
          <Link href="/targets">
            <Button variant="outline"><Target className="h-4 w-4" /> Daily Targets</Button>
          </Link>
        }
      />
      {isFuture && <Alert tone="amber" className="mb-4">This is a future date. Amounts and leads can only be recorded for today or earlier.</Alert>}

      {perf.error ? (
        <Card><ErrorState message={perf.error.message} onRetry={() => perf.mutate()} /></Card>
      ) : loading ? (
        <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div>
      ) : teamAggs.filter((t) => rowsByTeam.has(t.teamId)).length === 0 && individuals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={`No targets assigned for ${formatDate(date)}`}
            description="Assign today's team or individual targets first; then record progress here through the day."
            action={<Link href="/targets"><Button>Assign targets</Button></Link>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {teamAggs
            .filter((t) => rowsByTeam.has(t.teamId))
            .map((t) => (
              <TeamProgressCard
                key={t.teamId}
                team={t}
                info={teams.data!.find((x) => x.id === t.teamId)}
                rows={rowsByTeam.get(t.teamId)!}
                closed={isClosed(t.teamId)}
                lock={teamLock.get(t.teamId)}
                canManage={!isEmployee && !!meta.teams.find((x) => x.id === t.teamId)?.manageable}
                date={date}
                disabled={isFuture}
                onAddAmount={setAddAmountFor}
                onAddLead={setAddLeadFor}
                onClose={() => setClosing(t)}
                onReopen={() => reopen(t)}
              />
            ))}
          {individuals.length > 0 && (
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-semibold">Individual targets (not in a team)</h3>
              </div>
              <MemberTable rows={individuals} date={date} leaderId={null} disabled={isFuture} onAddAmount={setAddAmountFor} onAddLead={setAddLeadFor} />
            </Card>
          )}
        </div>
      )}

      {!loading && teamsWithoutTargets.length > 0 && (
        <Alert tone="blue" className="mt-6" title="Teams without a target for this date">
          {teamsWithoutTargets.map((t) => t.name).join(", ")} — <Link href="/targets" className="font-medium underline">assign their targets</Link> to track progress here.
        </Alert>
      )}

      <AchievementFormDialog open={!!addAmountFor} onOpenChange={(o) => !o && setAddAmountFor(null)} defaultEmployeeId={addAmountFor} />
      <LeadFormDialog open={!!addLeadFor} onOpenChange={(o) => !o && setAddLeadFor(null)} defaultOwnerId={addLeadFor} />
      {closing && (
        <CloseDayDialog
          team={closing}
          date={date}
          onClose={() => setClosing(null)}
          onClosed={(success) => {
            setClosing(null);
            if (success) {
              try {
                sessionStorage.setItem(`celebrated:${date}:${closing.teamId}`, "1");
              } catch {
                /* ignore */
              }
              setConfettiShot((n) => n + 1);
            }
          }}
        />
      )}
      {reason.element}
    </>
  );
}

function TeamProgressCard(props: {
  team: TeamAgg;
  info: TeamInfo | undefined;
  rows: PerfRow[];
  closed: boolean;
  lock: Submission | undefined;
  canManage: boolean;
  date: string;
  disabled: boolean;
  onAddAmount: (id: string) => void;
  onAddLead: (id: string) => void;
  onClose: () => void;
  onReopen: () => void;
}) {
  const { team: t, rows, closed, lock } = props;
  const win = reached(t);
  const hasMoney = Number(t.goalTarget) > 0;
  const exceededBy = Number(t.achieved) - Number(t.goalTarget);

  return (
    <Card className={cn("overflow-hidden", closed && win && "ring-2 ring-emerald-400")}>
      {/* Result banner after the day is closed */}
      {closed && (
        <div className={cn("flex flex-wrap items-center gap-3 px-5 py-3 text-sm", win ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white" : "bg-amber-50 text-amber-900")}>
          {win ? <Trophy className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
          <span className="font-semibold">
            {win
              ? `Target reached! ${hasMoney ? `${formatINR(t.achieved)} of ${formatINR(t.goalTarget)}` : `${t.leads} of ${t.goalLeadTarget} leads`}${exceededBy > 0 && hasMoney ? ` — exceeded by ${formatINR(exceededBy)}` : ""}`
              : `Day closed with a balance of ${formatINR(t.goalBalance)} (${formatINR(t.achieved)} of ${formatINR(t.goalTarget)})`}
          </span>
          {win && <PartyPopper className="h-5 w-5" />}
          <span className={cn("ml-auto text-xs", win ? "text-emerald-50" : "text-amber-700")}>Closed {lock?.lockedAt ? formatDateTime(lock.lockedAt) : ""}</span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-navy">
            {t.teamName}
            {closed ? <Badge tone={win ? "green" : "amber"}>{win ? "Closed · Target reached" : "Closed"}</Badge> : <Badge tone="blue">Open</Badge>}
            {t.modes.includes("INDEPENDENT") && <Badge tone="violet">Independent team goal</Badge>}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
            <Crown className="h-3.5 w-3.5 text-amber-500" /> {props.info?.leader?.name ?? "No leader"} · {rows.length} member(s) with targets
          </p>
        </div>
        {props.canManage && (
          closed ? (
            <Button variant="outline" size="sm" onClick={props.onReopen}><LockOpen className="h-3.5 w-3.5" /> Reopen day</Button>
          ) : (
            <Button size="sm" variant={win ? "success" : "primary"} onClick={props.onClose} disabled={props.disabled}>
              <Lock className="h-3.5 w-3.5" /> Close day for team
            </Button>
          )
        )}
      </div>

      <CardBody className="grid gap-4 border-b border-slate-100 md:grid-cols-2">
        <Summary
          label="Amount"
          done={formatINR(t.achieved)}
          goal={formatINR(t.goalTarget)}
          pct={t.goalPct}
          balance={Number(t.goalBalance) > 0 ? `Balance ${formatINR(t.goalBalance)}` : exceededBy > 0 ? `Exceeded by ${formatINR(exceededBy)}` : "Target met"}
          met={Number(t.goalBalance) === 0 && hasMoney}
        />
        <Summary
          label="New leads"
          done={String(t.leads)}
          goal={String(t.goalLeadTarget)}
          pct={t.goalLeadPct}
          balance={t.goalLeadBalance > 0 ? `${t.goalLeadBalance} lead(s) to go` : t.goalLeadTarget > 0 ? "Lead target met" : "No lead target"}
          met={t.goalLeadBalance === 0 && t.goalLeadTarget > 0}
        />
      </CardBody>

      <MemberTable rows={rows} date={props.date} leaderId={props.info?.leader?.id ?? null} disabled={props.disabled} onAddAmount={props.onAddAmount} onAddLead={props.onAddLead} />
    </Card>
  );
}

function Summary({ label, done, goal, pct, balance, met }: { label: string; done: string; goal: string; pct: number | null; balance: string; met: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <PctCell value={pct} />
      </div>
      <p className="tabular mt-1 text-xl font-semibold text-navy">
        {done} <span className="text-sm font-normal text-slate-500">of {goal}</span>
      </p>
      <Progress value={pct} className="mt-2 h-2" />
      <p className={cn("mt-2 text-sm font-medium", met ? "text-emerald-600" : "text-amber-700")}>{balance}</p>
    </div>
  );
}

function MemberTable({ rows, date, leaderId, disabled, onAddAmount, onAddLead }: { rows: PerfRow[]; date: string; leaderId: string | null; disabled: boolean; onAddAmount: (id: string) => void; onAddLead: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...rows].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-8" />
          <Th>Member</Th>
          <Th align="right">Target</Th>
          <Th align="right">Achieved</Th>
          <Th align="right">Balance</Th>
          <Th align="right">%</Th>
          <Th align="center">Leads</Th>
          <Th>Status</Th>
          <Th align="right">Record progress</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <MemberRow key={r.employeeId} r={r} date={date} isLeader={r.employeeId === leaderId} expanded={open === r.employeeId} onToggle={() => setOpen(open === r.employeeId ? null : r.employeeId)} disabled={disabled} onAddAmount={onAddAmount} onAddLead={onAddLead} />
        ))}
      </tbody>
    </Table>
  );
}

function MemberRow({ r, date, isLeader, expanded, onToggle, disabled, onAddAmount, onAddLead }: { r: PerfRow; date: string; isLeader: boolean; expanded: boolean; onToggle: () => void; disabled: boolean; onAddAmount: (id: string) => void; onAddLead: (id: string) => void }) {
  return (
    <>
      <tr className="hover:bg-slate-50/60">
        <Td>
          <button onClick={onToggle} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy" aria-label={expanded ? "Hide entries" : "Show entries"} aria-expanded={expanded}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </Td>
        <Td>
          <span className="font-medium">{r.employeeName}</span> <span className="text-xs text-slate-400">{r.employeeCode}</span>
          {isLeader && <Badge tone="amber" className="ml-2">Leader</Badge>}
          {!r.hasAllocation && <Badge tone="slate" className="ml-2">No target</Badge>}
        </Td>
        <Td align="right"><MoneyCell value={r.target} /></Td>
        <Td align="right"><MoneyCell value={r.achieved} className="font-semibold" /></Td>
        <Td align="right">
          {Number(r.balance) > 0 ? <MoneyCell value={r.balance} className="text-amber-700" /> : <span className="text-emerald-600">{Number(r.target) > 0 ? "Met" : "—"}</span>}
        </Td>
        <Td align="right"><PctCell value={r.pct} /></Td>
        <Td align="center"><span className="tabular">{r.leads}</span><span className="text-slate-400"> / {r.leadTarget}</span></Td>
        <Td><StatusBadge status={r.status} /></Td>
        <Td align="right">
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAddAmount(r.employeeId)}><IndianRupee className="h-3.5 w-3.5" /> Amount</Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAddLead(r.employeeId)}><UserPlus className="h-3.5 w-3.5" /> Lead</Button>
          </div>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="border-b border-slate-100 bg-slate-50/60 px-6 py-4">
            <MemberDetail employeeId={r.employeeId} date={date} />
          </td>
        </tr>
      )}
    </>
  );
}

interface Detail {
  entries: { id: string; amount: string; countsTowardTarget: boolean; description: string | null; referenceNo: string | null; notes: string | null; categoryId: string; leadId: string | null; createdAt: string; category: { name: string } }[];
  leads: { id: string; companyName: string; contactPerson: string | null; phone: string; email: string | null; status: string; counted: boolean }[];
}

function MemberDetail({ employeeId, date }: { employeeId: string; date: string }) {
  const { data, error } = useApi<Detail>(`/api/reports/detail${qs({ date, employeeId })}`);
  const [editing, setEditing] = useState<AchievementEditing | null>(null);
  const reason = useReasonPrompt();
  const remove = async (e: Detail["entries"][number]) => {
    const why = await reason.prompt(`Remove the ₹${Number(e.amount).toLocaleString("en-IN")} entry?`);
    if (!why) return;
    try {
      await api(`/api/achievements/${e.id}`, { method: "DELETE", body: { reason: why } });
      toast.success("Amount removed — balance recalculated");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    }
  };
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (!data) return <Skeleton className="h-20" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Amounts recorded today ({data.entries.length})</p>
        {data.entries.length === 0 ? (
          <p className="text-sm text-slate-500">No amounts recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 shadow-sm">
                <span>
                  <span className="text-xs text-slate-500">{new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>{" "}
                  {e.category.name}
                  {e.description && <span className="text-slate-500"> · {e.description}</span>}
                  {!e.countsTowardTarget && <Badge tone="amber" className="ml-2">Pipeline — not counted</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <MoneyCell value={e.amount} className={e.countsTowardTarget ? "font-semibold" : "text-slate-400 line-through"} />
                  <Button size="sm" variant="ghost" aria-label="Edit amount" onClick={() => setEditing({ id: e.id, date, employeeId, categoryId: e.categoryId, amount: String(e.amount), description: e.description, leadId: e.leadId, referenceNo: e.referenceNo, notes: e.notes })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Remove amount" onClick={() => remove(e)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Leads added today ({data.leads.length})</p>
        {data.leads.length === 0 ? (
          <p className="text-sm text-slate-500">No leads added yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 shadow-sm">
                <span>
                  <Link href={`/leads/${l.id}`} className="font-medium text-brand-700 hover:underline">{l.companyName}</Link>
                  <span className="block text-xs text-slate-500">{[l.contactPerson, l.phone, l.email].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <LeadStatusBadge status={l.status} />
                  {!l.counted && <Badge tone="slate">Not counted</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AchievementFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} editing={editing} />
      {reason.element}
    </div>
  );
}

function CloseDayDialog({ team: t, date, onClose, onClosed }: { team: TeamAgg; date: string; onClose: () => void; onClosed: (success: boolean) => void }) {
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const win = reached(t);
  const submit = async () => {
    setSaving(true);
    try {
      await api("/api/reports/submissions", { body: { date, scope: "TEAM", teamId: t.teamId, managerRemarks: remarks || null, lock: true } });
      await refreshAll();
      if (win) toast.success(`${t.teamName} reached the target! 🎉`);
      else toast.message(`${t.teamName} closed with a balance of ${formatINR(t.goalBalance)}`);
      onClosed(win);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not close the day");
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Close ${formatDate(date)} for ${t.teamName}`}
      description="Closing saves the day's final result and locks it. Later changes need a correction reason and are audited."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={win ? "success" : "primary"} loading={saving} onClick={submit}><Lock className="h-4 w-4" /> Close day</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Team target" value={formatINR(t.goalTarget)} />
          <Stat label="Achieved" value={formatINR(t.achieved)} tone="green" />
          <Stat label={win ? "Balance" : "Balance"} value={formatINR(t.goalBalance)} tone={Number(t.goalBalance) > 0 ? "amber" : "green"} />
        </div>
        <p className="text-center text-sm text-slate-600">
          Leads: <b>{t.leads}</b> of {t.goalLeadTarget}
          {t.goalLeadBalance > 0 ? ` · ${t.goalLeadBalance} to go` : t.goalLeadTarget > 0 ? " · met" : ""}
        </p>
        {win ? (
          <Alert tone="green" title="Target reached 🎉">The team will be marked as successful for this day.</Alert>
        ) : (
          <Alert tone="amber" title={`Balance of ${formatINR(t.goalBalance)} remains`}>The day will close with this balance recorded.</Alert>
        )}
        <Field label="Remarks (optional)">
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Two large orders expected tomorrow" maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={cn("tabular mt-1 text-base font-semibold", tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-700" : "text-navy")}>{value}</p>
    </div>
  );
}
