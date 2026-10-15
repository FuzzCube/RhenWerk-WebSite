import { createHash } from "node:crypto";

// Pause after repeated wrong passwords (task-11-6). The schedule lives in the database (login_failed); here only
// the key and the message. Pure functions, usable in tests.

// Key of an address: SHA-256 of the trimmed, lower-case e-mail; the address itself is not stored
export function loginKey(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// "30 Sekunden", "1 Minute", "2 Minuten" … (rounded up to whole minutes from 60 s)
export function pauseText(seconds: number) {
  if (seconds < 60) {
    const whole = Math.max(1, Math.ceil(seconds));
    return whole === 1 ? "1 Sekunde" : `${whole} Sekunden`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 Minute" : `${minutes} Minuten`;
}

export const pauseMessage = (seconds: number) => `Zu viele Fehlversuche. Bitte in ${pauseText(seconds)} erneut versuchen.`;
