// Costs of OpenAI for the automation in n8n (task-19-5): the watchdog reads the spend of the current month from the
// Costs API of the organisation (needs an admin key, OPENAI_ADMIN_KEY) and compares it with the budget the owner sets
// (OPENAI_BUDGET_USD, e.g. the prepaid credit). OpenAI has no API for the remaining prepaid balance, so "remaining"
// is budget minus spend. Read at most once an hour; shown in the area "System" next to the credit of ElevenLabs.
export const OPENAI_CHECK_MINUTES = 60;

const monthStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Raw answer: spend in USD since the first day of the month (UTC, like the billing of OpenAI)
export async function collectOpenAI(env, now = new Date()) {
  if (!env.OPENAI_ADMIN_KEY) return { configured: false };
  const start = Math.floor(monthStart(now).getTime() / 1000);
  let spent = 0;
  let page = null;
  try {
    for (let round = 0; round < 5; round += 1) {
      const url = new URL("https://api.openai.com/v1/organization/costs");
      url.searchParams.set("start_time", String(start));
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const response = await fetch(url, { headers: { authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { configured: true, status: response.status };
      const body = await response.json();
      for (const bucket of body.data ?? []) for (const result of bucket.results ?? []) spent += Number(result.amount?.value ?? 0);
      if (!body.has_more || !body.next_page) break;
      page = body.next_page;
    }
  } catch (error) {
    return { configured: true, status: 0, error: error.message };
  }
  return { configured: true, status: 200, spent, month: monthStart(now).toISOString().slice(0, 7) };
}

// Raw answer → state and figures for the dashboard; warning when less than OPENAI_BUDGET_MIN_USD (default 10 % of
// the budget) is left, critical when the budget is used up
export function evaluateOpenAI(raw, { budget, budgetMin } = {}) {
  if (!raw.configured) return { state: "off", costs: null, detail: null };
  if (raw.status !== 200) {
    const reason = raw.status === 401 || raw.status === 403 ? "Admin-Key ungültig oder ohne Leserecht für Kosten" : raw.status ? `HTTP ${raw.status}` : `nicht erreichbar (${raw.error ?? "Zeitüberschreitung"})`;
    return { state: "warning", costs: null, detail: `Kosten nicht abrufbar: ${reason}` };
  }
  const spent = Math.round(raw.spent * 100) / 100;
  const limit = Number(budget) > 0 ? Number(budget) : null;
  const min = limit === null ? null : Number(budgetMin) > 0 ? Number(budgetMin) : Math.round(limit * 0.1 * 100) / 100;
  const remaining = limit === null ? null : Math.round((limit - spent) * 100) / 100;
  const state = remaining === null ? "ok" : remaining <= 0 ? "critical" : remaining < min ? "warning" : "ok";
  return { state, costs: { spent, month: raw.month, budget: limit, remaining, min }, detail: null };
}
