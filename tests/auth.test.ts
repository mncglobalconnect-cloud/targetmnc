import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { bootstrapAdminCredentials, passwordProblem } from "../src/lib/auth/admin";
import { signSession, verifySession } from "../src/lib/auth/session";

test("initial admin credentials prefer ADMIN_* and fall back to legacy STATIC_LOGIN_*", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_INITIAL_PASSWORD;
    process.env.STATIC_LOGIN_EMAIL = " Legacy@Example.invalid ";
    process.env.STATIC_LOGIN_PASSWORD = "legacy-pass-123";
    assert.deepEqual(bootstrapAdminCredentials(), { email: "legacy@example.invalid", password: "legacy-pass-123" });
    process.env.ADMIN_EMAIL = "admin@example.invalid";
    process.env.ADMIN_INITIAL_PASSWORD = "new-pass-12345";
    assert.deepEqual(bootstrapAdminCredentials(), { email: "admin@example.invalid", password: "new-pass-12345" });
    delete process.env.ADMIN_INITIAL_PASSWORD;
    delete process.env.STATIC_LOGIN_PASSWORD;
    assert.equal(bootstrapAdminCredentials().password, null);
  } finally {
    process.env = saved;
  }
});

test("password policy", () => {
  assert.match(passwordProblem("short1")!, /at least 10/);
  assert.match(passwordProblem("onlyletterslong")!, /letters and numbers/);
  assert.match(passwordProblem("admin-secret-123", "admin@example.invalid")!, /email name/);
  assert.equal(passwordProblem("Blue-river-2026", "admin@example.invalid"), null);
});

test("sessions carry the session version; tokens without one count as version 0", async () => {
  const saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "x".repeat(40);
  try {
    const token = await signSession({ uid: "u1", role: "SUPER_ADMIN", sv: 3 });
    assert.deepEqual(await verifySession(token), { uid: "u1", role: "SUPER_ADMIN", sv: 3 });
    const legacy = await new SignJWT({ uid: "u1", role: "SUPER_ADMIN" }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    assert.equal((await verifySession(legacy))?.sv, 0);
    assert.equal(await verifySession("not-a-token"), null);
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  }
});
