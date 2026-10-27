"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Dialog, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

const MIN = 10;

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    if (!current) return setError("Enter your current password.");
    if (next.length < MIN) return setError(`New password must be at least ${MIN} characters.`);
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError("New password must contain letters and numbers.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setSaving(true);
    try {
      await api("/api/auth/password", { body: { currentPassword: current, newPassword: next } });
      toast.success("Password changed", { description: "Other signed-in sessions have been signed out." });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change password"
      description="Stored securely (hashed) in the database. Changing it signs out your other sessions."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Change password</Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && <Alert tone="red">{error}</Alert>}
        <Field label="Current password" required>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="New password" required hint={`At least ${MIN} characters, with letters and numbers.`}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
