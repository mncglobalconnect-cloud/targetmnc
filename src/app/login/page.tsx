"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ShieldCheck, Target, Users } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/login", { body: { email, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  };

  return (
    // method="post" keeps credentials out of the URL if the form is submitted before hydration.
    <form method="post" onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="red">{error}</Alert>}
      <Field label="Work email" required>
        <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@mncgroups.com" autoFocus />
      </Field>
      <Field label="Password" required>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden>
            <rect width="64" height="64" rx="14" fill="#fff" />
            <path d="M14 46V18h6l12 15 12-15h6v28h-7V30l-11 13-11-13v16z" fill="#1d53f0" />
          </svg>
          <div>
            <p className="text-lg font-bold">MNC Groups</p>
            <p className="text-xs uppercase tracking-widest text-brand-100">Target & Lead Management</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Every target, every lead, every team — tracked to the rupee.</h1>
          <p className="mt-4 text-brand-100">Assign daily business and lead targets, record achievements, and see remaining balances update the moment work is logged.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              [Target, "Individual and team targets with allocation validation"],
              [Users, "Lead records with duplicate detection and attribution"],
              [BarChart3, "Daily, weekly, monthly and yearly reports with Excel downloads"],
              [ShieldCheck, "Role-based access with a complete audit trail"],
            ].map(([Icon, text], i) => {
              const I = Icon as React.ElementType;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="rounded-lg bg-white/15 p-1.5">
                    <I className="h-4 w-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-brand-200">© {new Date().getFullYear()} MNC Groups. Internal use only.</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-lg font-bold text-navy">MNC Groups</p>
            <p className="text-xs uppercase tracking-widest text-brand-600">Target & Lead Management</p>
          </div>
          <h2 className="text-2xl font-semibold text-navy">Sign in</h2>
          <p className="mb-6 mt-1 text-sm text-slate-500">Test mode: use the single administrator account configured on the server.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
