// Limits of the web widget "Mit Mira sprechen" (task-13-8, user decision 19.10.2026). The agent ends a conversation
// after MAX_SECONDS itself (agent:sync); the day budget and the hourly limit per client are kept by the database.
export const MIRA_MAX_SECONDS = 180;
export const MIRA_DAILY_SECONDS = 600;
export const MIRA_PER_CLIENT_HOUR = 3;

export type MiraBudget = { verfuegbar: boolean; restMinuten: number };
export type MiraStart =
  | { ok: true; signedUrl: string; sessionId: string; maxSeconds: number }
  | { ok: false; grund: "tageslimit" | "zu_viele" | "herkunft" | "stoerung" };
