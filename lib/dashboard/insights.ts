import "server-only";
import type { PeriodParams } from "@/lib/analytics";
import { berlinDayKey } from "@/lib/format";
import type { QueueRow, SeriesRow } from "@/lib/insights";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Data of the analysis page (task-7-3), all from the analytics functions with the user's rights.
// Long-term charts cover the last 24 months (seasonality: from January two years back), the queue
// history the last 90 days; comparison and automation table follow the selected period.
type AutomationRow = Database["public"]["Functions"]["analytics_automation"]["Returns"][number];
type Functions = Database["public"]["Functions"];
export type PhoneFigures = Functions["analytics_phone"]["Returns"][number];
export type PhoneCategoryRow = Functions["analytics_phone_categories"]["Returns"][number];
export type PhoneDayRow = Functions["analytics_phone_days"]["Returns"][number];

export type Insights = {
  today: string;
  window: { current_start: string; current_end: string; previous_start: string; previous_end: string; is_complete: boolean; startDay: string; endDay: string };
  months: SeriesRow[];
  seasonalMonths: SeriesRow[];
  currentDays: SeriesRow[];
  previousDays: SeriesRow[];
  queues: QueueRow[];
  automation: AutomationRow[];
  // Phone assistant (task-13-7), selected period and previous period
  phone: { current: PhoneFigures | null; previous: PhoneFigures | null; categories: PhoneCategoryRow[]; days: PhoneDayRow[] };
};

const shiftDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
// Last local day of a span with exclusive end
const lastDay = (end: string) => berlinDayKey(new Date(new Date(end).getTime() - 1));

export async function getInsights(period: PeriodParams): Promise<Insights> {
  const supabase = await createClient();
  const today = berlinDayKey(new Date());
  const [year, month] = today.split("-").map(Number);
  const monthsFrom = new Date(Date.UTC(year, month - 1 - 23, 1)).toISOString().slice(0, 10);
  const seasonFrom = `${year - 2}-01-01`;
  const args = { kind: period.kind, ...(period.anchor ? { anchor: period.anchor } : {}) };

  const windowResult = await supabase.rpc("analytics_window", args).single();
  if (windowResult.error || !windowResult.data) throw new Error("Zeitraum konnte nicht geladen werden.");
  const w = windowResult.data;
  const startDay = berlinDayKey(w.current_start);
  const currentLast = w.current_end > w.current_start ? lastDay(w.current_end) : startDay;
  const previousLast = w.previous_end > w.previous_start ? lastDay(w.previous_end) : berlinDayKey(w.previous_start);

  const [months, seasonal, currentDays, previousDays, queues, automation, phone, phoneCategories, phoneDays] = await Promise.all([
    supabase.rpc("analytics_series", { granularity: "month", from_date: monthsFrom, to_date: today }),
    supabase.rpc("analytics_series", { granularity: "month", from_date: seasonFrom, to_date: today }),
    supabase.rpc("analytics_series", { granularity: "day", from_date: startDay, to_date: currentLast }),
    supabase.rpc("analytics_series", { granularity: "day", from_date: berlinDayKey(w.previous_start), to_date: previousLast }),
    supabase.rpc("analytics_queue_history", { from_date: shiftDays(today, -89), to_date: today }),
    supabase.rpc("analytics_automation", args),
    supabase.rpc("analytics_phone", args),
    supabase.rpc("analytics_phone_categories", args),
    supabase.rpc("analytics_phone_days", { from_date: startDay, to_date: currentLast }),
  ]);
  for (const result of [months, seasonal, currentDays, previousDays, queues, automation, phone, phoneCategories, phoneDays]) {
    if (result.error) throw new Error("Auswertung konnte nicht geladen werden.");
  }
  return {
    today,
    window: { ...w, startDay, endDay: lastDay(w.period_end) },
    months: months.data as SeriesRow[],
    seasonalMonths: seasonal.data as SeriesRow[],
    currentDays: currentDays.data as SeriesRow[],
    previousDays: previousDays.data as SeriesRow[],
    queues: queues.data as QueueRow[],
    automation: automation.data ?? [],
    phone: {
      current: phone.data?.find((row) => row.period === "current") ?? null,
      previous: phone.data?.find((row) => row.period === "previous") ?? null,
      categories: phoneCategories.data ?? [],
      days: phoneDays.data ?? [],
    },
  };
}
