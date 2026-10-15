// Password rules of the dashboard (task-11-5). Shared by reset, own change and admin reset; no secrets.
// Same rule as for new accounts in Verwaltung (lib/admin.ts uses this constant)
export const MIN_PASSWORD_LENGTH = 12;
// A reset link opens a session with sign-in method "otp"; only such a fresh session may set a password without
// the current one (same lifetime as the link)
export const RECOVERY_WINDOW_SECONDS = 3600;

export function newPasswordErrors(password: string, repeat: string, current?: string) {
  const errors: Record<string, string> = {};
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
  else if (password.trim() !== password) errors.password = "Ohne Leerzeichen am Anfang oder Ende.";
  else if (current !== undefined && password === current) errors.password = "Das neue Passwort muss sich vom bisherigen unterscheiden.";
  if (repeat !== password) errors.password_repeat = "Die Passwörter stimmen nicht überein.";
  return errors;
}

type Amr = Array<{ method?: string; timestamp?: number }> | undefined;

export function isFreshRecovery(amr: Amr, nowSeconds = Math.floor(Date.now() / 1000)) {
  return (amr ?? []).some((entry) => (entry.method === "otp" || entry.method === "recovery")
    && typeof entry.timestamp === "number" && nowSeconds - entry.timestamp <= RECOVERY_WINDOW_SECONDS);
}
