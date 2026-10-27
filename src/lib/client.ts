"use client";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(0, "Network error — check your connection. Your input has been kept.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, (data as { details?: unknown }).details);
  return data as T;
}

export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(url, (u: string) => api<T>(u), { revalidateOnFocus: true, keepPreviousData: true, ...config });
}

/** Revalidate every cached API query (after a save, numbers update everywhere). */
export function refreshAll() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, { revalidate: true });
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : "";
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Drafts remain in memory; saved business data is persisted in MongoDB. */
export function useDraft<T extends object>(key: string, initial: T) {
  const [drafts, setDrafts] = useState<Record<string, T>>({});
  const value = drafts[key] ?? initial;
  const setValue: Dispatch<SetStateAction<T>> = (next) =>
    setDrafts((current) => ({ ...current, [key]: typeof next === "function" ? next(current[key] ?? initial) : next }));
  const clear = useCallback(
    (next?: T) => setDrafts((current) => ({ ...current, [key]: next ?? initial })),
    [key, initial],
  );
  return [value, setValue, clear] as const;
}

export const STATUS_META: Record<string, { label: string; tone: "green" | "teal" | "blue" | "amber" | "red" | "slate" | "violet" }> = {
  OVERACHIEVED: { label: "Overachieved", tone: "violet" },
  COMPLETED: { label: "Completed", tone: "green" },
  ON_TRACK: { label: "On Track", tone: "blue" },
  AT_RISK: { label: "At Risk", tone: "red" },
  NOT_STARTED: { label: "Not Started", tone: "slate" },
  PARTIAL: { label: "Partially Achieved", tone: "amber" },
  MISSED: { label: "Missed", tone: "red" },
  NO_TARGET: { label: "No Target", tone: "slate" },
};

export const LEAD_STATUS_META: Record<string, { label: string; tone: "green" | "teal" | "blue" | "amber" | "red" | "slate" | "violet" }> = {
  NEW: { label: "New", tone: "blue" },
  CONTACTED: { label: "Contacted", tone: "teal" },
  QUALIFIED: { label: "Qualified", tone: "violet" },
  PROPOSAL_SENT: { label: "Proposal Sent", tone: "amber" },
  NEGOTIATION: { label: "Negotiation", tone: "amber" },
  CONVERTED: { label: "Converted", tone: "green" },
  LOST: { label: "Lost", tone: "red" },
  ON_HOLD: { label: "On Hold", tone: "slate" },
};
export const LEAD_STATUSES = Object.keys(LEAD_STATUS_META);

export async function downloadUrl(url: string) {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiClientError(response.status, data.error ?? `Download failed (${response.status})`);
    }
    const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
    if (!filename) throw new Error("The server did not return a downloadable report.");
    const objectUrl = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Report download failed. Try again.");
  }
}
