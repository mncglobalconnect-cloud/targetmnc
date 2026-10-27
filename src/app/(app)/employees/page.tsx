"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building, Pencil, Plus, Search, Users } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, Pagination, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { PageHeader } from "@/components/shared";
import { useApp } from "@/components/app-context";
import { api, qs, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";

type Role = "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";

interface EmployeeRow {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  department: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  active: boolean;
  joinedOn: string | null;
  user: { id?: string; email?: string; role: Role; active?: boolean; lastLoginAt?: string | null } | null;
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  rows: EmployeeRow[];
}

export default function EmployeesPage() {
  const { meta, isAdmin } = useApp();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [active, setActive] = useState<"true" | "false" | "all">("true");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeRow | "new" | null>(null);
  const [deptOpen, setDeptOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, isLoading, mutate } = useApi<ListResponse>(`/api/employees${qs({ q: debouncedQ, departmentId, teamId, active, page, pageSize: 25 })}`);

  return (
    <>
      <PageHeader
        title="Employees"
        description={isAdmin ? "Manage employees and teams. Testing uses one static administrator login." : "Employees in the teams you lead."}
        actions={
          isAdmin && (
            <>
              <Button variant="outline" onClick={() => setDeptOpen(true)}><Building className="h-4 w-4" /> Add department</Button>
              <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add employee</Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, email…" className="pl-9" aria-label="Search employees" />
          </div>
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} className="w-full sm:w-44" aria-label="Department">
            <option value="">All departments</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); setPage(1); }} className="w-full sm:w-44" aria-label="Team">
            <option value="">All teams</option>
            {meta.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select value={active} onChange={(e) => { setActive(e.target.value as typeof active); setPage(1); }} className="w-full sm:w-36" aria-label="Status">
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : data.rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No employees found" description="Try adjusting the filters." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Department</Th>
                  <Th>Team</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  {isAdmin && <Th>Last login</Th>}
                  {isAdmin && <Th align="right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <Td className="text-xs text-slate-500">{e.code}</Td>
                    <Td>
                      <span className="font-medium">{e.name}</span>
                      {e.designation && <span className="block text-xs text-slate-500">{e.designation}</span>}
                    </Td>
                    <Td>{e.department?.name ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{e.teams.length ? e.teams.map((t) => t.name).join(", ") : <span className="text-slate-400">—</span>}</Td>
                    <Td>{e.email ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{e.phone ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{e.user ? <Badge tone={e.user.role === "SUPER_ADMIN" ? "violet" : e.user.role === "MANAGER" ? "blue" : "slate"}>{titleCase(e.user.role)}</Badge> : <span className="text-xs text-slate-400">No login</span>}</Td>
                    <Td>
                      {e.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}
                      {e.user && e.user.active === false && <Badge tone="amber" className="ml-1">Login disabled</Badge>}
                    </Td>
                    {isAdmin && <Td className="text-xs text-slate-500">{e.user?.lastLoginAt ? formatDateTime(e.user.lastLoginAt) : "—"}</Td>}
                    {isAdmin && (
                      <Td align="right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Edit ${e.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {isAdmin && editing && <EmployeeDialog employee={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {isAdmin && <DepartmentDialog open={deptOpen} onOpenChange={setDeptOpen} />}
    </>
  );
}

interface Form {
  code: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  departmentId: string;
  joinedOn: string;
  teamId: string;
  active: boolean;
}

function EmployeeDialog({ employee, onClose }: { employee: EmployeeRow | null; onClose: () => void }) {
  const { meta } = useApp();
  const [f, setF] = useState<Form>({
    code: employee?.code ?? "",
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    designation: employee?.designation ?? "",
    departmentId: employee?.department?.id ?? "",
    joinedOn: employee?.joinedOn ?? "",
    teamId: "",
    active: employee?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!employee && !/^.{1,30}$/.test(f.code.trim())) e.code = "Employee code is required";
    if (f.name.trim().length < 2) e.name = "Name must be at least 2 characters";
    if (f.email && !emailRe.test(f.email)) e.email = "Enter a valid email";
    if (f.phone && !/^[+()\-\s\d]{7,25}$/.test(f.phone)) e.phone = "Enter a valid phone number";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    setServerError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      if (!employee) {
        await api("/api/employees", {
          body: {
            code: f.code.trim(),
            name: f.name.trim(),
            email: f.email,
            phone: f.phone,
            designation: f.designation,
            departmentId: f.departmentId || null,
            joinedOn: f.joinedOn || null,
            teamId: f.teamId || null,
          },
        });
        toast.success(`Employee ${f.name.trim()} created`);
      } else {
        await api(`/api/employees/${employee.id}`, {
          method: "PATCH",
          body: {
            name: f.name.trim(),
            email: f.email,
            phone: f.phone,
            designation: f.designation,
            departmentId: f.departmentId || null,
            joinedOn: f.joinedOn || null,
            active: f.active,
          },
        });
        toast.success("Employee updated");
      }
      await refreshAll();
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not save employee");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={employee ? `Edit ${employee.name}` : "Add employee"}
      description={employee ? `Code ${employee.code}` : "Team membership can be changed later from the Teams page."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={save}>{employee ? "Save changes" : "Create employee"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {serverError && <Alert tone="red" className="sm:col-span-2">{serverError}</Alert>}
        {!employee && (
          <Field label="Employee code" required error={errors.code}>
            <Input value={f.code} onChange={(e) => set("code", e.target.value)} maxLength={30} placeholder="EMP007" invalid={!!errors.code} />
          </Field>
        )}
        <Field label="Full name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} invalid={!!errors.name} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={200} invalid={!!errors.email} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={25} invalid={!!errors.phone} />
        </Field>
        <Field label="Designation">
          <Input value={f.designation} onChange={(e) => set("designation", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Department">
          <Select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
            <option value="">None</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Joined on">
          <Input type="date" value={f.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
        </Field>
        {!employee ? (
          <Field label="Initial team" hint="Membership starts on the joined date (or today).">
            <Select value={f.teamId} onChange={(e) => set("teamId", e.target.value)}>
              <option value="">None</option>
              {meta.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        ) : (
          <div className="flex items-end pb-2">
            <Checkbox checked={f.active} onChange={(v) => set("active", v)} label="Employee is active" description="Inactive employees cannot sign in and get no new targets. History is kept." />
          </div>
        )}

        <Alert tone="blue" className="sm:col-span-2">Employee login accounts are disabled during testing. Use the single static administrator account.</Alert>
        {employee?.joinedOn && <p className="text-xs text-slate-500 sm:col-span-2">Joined {formatDate(employee.joinedOn)}</p>}
      </div>
    </Dialog>
  );
}

function DepartmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { meta } = useApp();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (name.trim().length < 2) return setError("Department name must be at least 2 characters.");
    setSaving(true);
    try {
      await api("/api/departments", { body: { name: name.trim() } });
      toast.success(`Department "${name.trim()}" added`);
      setName("");
      await refreshAll();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add department");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Add department"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={saving} onClick={save}>Add</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <Field label="Department name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
        </Field>
        {meta.departments.length > 0 && <p className="text-xs text-slate-500">Existing: {meta.departments.map((d) => d.name).join(", ")}</p>}
      </div>
    </Dialog>
  );
}
