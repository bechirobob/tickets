// Kept separate from the database module so no server code enters the browser bundle.
export const RECOVERY_ERROR = "This setup link is invalid, expired or already used. Ask for a fresh link.";
export const isRecoveryToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
