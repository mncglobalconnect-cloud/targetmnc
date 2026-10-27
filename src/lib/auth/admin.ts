// Administrator account stored in MongoDB (`users` collection, bcrypt password hash).
// .env values are used only ONCE, to create the admin when no password is stored yet.

/** Kept from the earlier static login so existing audit-log entries stay linked to the admin. */
export const ADMIN_USER_ID = "static-admin";
export const MIN_PASSWORD_LENGTH = 10;
export const BCRYPT_ROUNDS = 12;

/** Initial admin credentials for first-time setup (ADMIN_* preferred; legacy STATIC_LOGIN_* still accepted). */
export function bootstrapAdminCredentials(): { email: string; password: string | null } {
  const email = (process.env.ADMIN_EMAIL || process.env.STATIC_LOGIN_EMAIL || "admin@mncgroups.com").trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD || process.env.STATIC_LOGIN_PASSWORD || null;
  return { email, password };
}

/** Returns a reason the password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must contain letters and numbers.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Password must not contain your email name.";
  return null;
}
