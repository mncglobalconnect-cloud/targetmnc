"use client";
import { AppProvider } from "@/components/app-context";
import { AppShell, ShellSkeleton } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
