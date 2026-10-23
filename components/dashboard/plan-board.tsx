"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { closeVisitChange, confirmVisitChange, offerVisitChange, rescheduleVisit, scheduleVisit } from "@/app/(dashboard)/dashboard/planung/actions";
import { CheckboxField, HiddenField, SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { Icon } from "@/components/ui";
import { addDays, berlinToInstant, dayKeyOf, isDayKey, isoWeek, isoWeekday, isTime, minutesOfDay, weekStart } from "@/lib/berlin-time";
import type { BusyBlock, Technician, WorkingHours } from "@/lib/dashboard/planning";
import { initialFormState, type FormState } from "@/lib/forms";
import { formatWeekdayDate, TIME_ZONE } from "@/lib/format";
import type { PlanningChange } from "@/lib/dashboard/planning";
import { unreadText } from "@/lib/dashboard/unread";
import { hoursOn, nextWorkingDays, slotReasonText, suggestSlots, type SlotBusy, type SlotExperience } from "@/lib/slot-suggestions";
import type { MonthLoad } from "@/lib/technician-load";

// Planning board of the Einsatzplanung (task-10-3, redesign after the user's dashboard draft
// "Einsatzplanung Redesign"): one board for the working week (Monday to Friday) or a single day, suggestions and the booking
// form in one panel. Picking a slot and changing the duration happen in the browser (no server round trip);
// the URL is kept in sync with history.replaceState. Paging the board loads the new days from the server.
// The database stays the authority for conflicts (schedule_visit, RW410); the board only warns early.

const MONTH_SHORT = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
const MONTH_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export type BoardPick = { technicianId: string; day: string; start: string; end: string };

type Props = {
  technicians: Technician[];
  workingHours: WorkingHours[];
  // Occupancy of the shown days, with request numbers for readable visits
  busy: BusyBlock[];
  // Next 7 working days from today for suggestions and the conflict check (the board shows the week Monday to Friday)
  availability: { days: string[]; now: string; busy: SlotBusy[]; experience: Record<string, SlotExperience> };
  view: "woche" | "tag";
  days: string[];
  anchor: string;
  focusDay: string;
  request: { id: string; version: number; number: string } | null;
  requestSummary: ReactNode;
  // Panel content when nothing can be planned (no request selected, already planned, all done)
  emptyPanel: ReactNode;
  initialDuration: number;
  initialPick: BoardPick | null;
  // false when the request has an open hold (task-20-13): the customer's wish decides, no suggestions
  suggest: boolean;
  // The customer wants to move a planned visit (task-20-16): wish, options and the answers of the dispatcher
  change: PlanningChange | null;
  // Load per technician in the calendar month of the shown day (task-12-1); month as its first day
  monthLoads: { month: string; loads: Record<string, MonthLoad> };
};

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
// Board position of a visit within one day
const pickOf = (block: BusyBlock): BoardPick => ({
  technicianId: block.technicianId,
  day: dayKeyOf(new Date(block.start)),
  start: toTime(minutesOfDay(new Date(block.start))),
  end: toTime(minutesOfDay(new Date(block.end))),
});
const shortDay = (day: string) => formatWeekdayDate(`${day}T12:00:00Z`).replace(/\d{4}$/, "");
const longDayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE });
const longDay = (day: string) => longDayFormat.format(new Date(`${day}T12:00:00Z`));
// Hold on the board (task-20-13): colour and text tell wish met, deviating from the wish (agree with the customer)
// or agreed by Mira on the phone
const HOLD_TEXT = { wish: "Wunschtermin", deviates: "abweichend vom Wunsch, mit Kunde abstimmen", mira: "mit Mira vereinbart" } as const;
const HOLD_MARK = { wish: "", deviates: "!", mira: "M" } as const;
const holdLabel = (block: BusyBlock) => {
  const base = `Vorgemerkt ${block.requestNumber ?? ""}`.trim();
  if (!block.hold) return base;
  const wish = block.hold.state === "deviates" && block.hold.wish ? ` (Wunsch: ${block.hold.wish})` : "";
  return `${base} · ${HOLD_TEXT[block.hold.state]}${wish}`;
};
const nextWorkday = (day: string, step: 1 | -1) => {
  let next = addDays(day, step);
  while (isoWeekday(next) > 5) next = addDays(next, step);
  return next;
};

type Segment = { start: number; end: number; kind: "own" | "busy" | "absence" | "hold"; label: string; block: BusyBlock };
// Dragging the selection (task-10-7) or a planned visit (task-10-8): the block snaps to the 15-minute grid and slides
// there (task-19-4, CSS transition), so it always shows the time it will get (snapped); x/y place the time tip next to
// the pointer. A moved visit is left out of the conflict check (ignore), it does not collide with itself.
type Drag = { technicianId: string; day: string; snapped: BoardPick; x: number; y: number; ignore: Ignore | null };
type Ignore = { technicianId: string; start: number; end: number };
// Visit dropped somewhere else, waiting for confirmation (old → new, reason, e-mail to the customer)
// error: message of a failed save, belongs to this move only (a new drag starts without it)
type Move = { block: BusyBlock; visitId: string; version: number; from: BoardPick; to: BoardPick; error?: string };
const DRAG_STEP = 15;
const DEFAULT_REASON = "Verschoben auf der Plantafel";
const RESIZE_REASON = "Dauer geändert auf der Plantafel";
// Only the length changed (task-20-3): same technician, day and either start or end
const onlyLength = (move: Move) => move.to.technicianId === move.from.technicianId && move.to.day === move.from.day && (move.to.start === move.from.start || move.to.end === move.from.end);
const ignoreOf = (block: BusyBlock): Ignore => ({ technicianId: block.technicianId, start: Date.parse(block.start), end: Date.parse(block.end) });
// Length of a selection in words (task-20-5: any length on the 15-minute grid): "2 h", "1 h 15 min", "45 min"
const durationText = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export function PlanBoard(props: Props) {
  const { technicians, workingHours, busy, availability, view, days, anchor, focusDay, request } = props;
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [duration, setDuration] = useState(props.initialDuration);
  const [pick, setPick] = useState<BoardPick | null>(props.initialPick);
  // Changes when the board sets a slot, so the form shows it; typing in the form keeps the key
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  // Visit chosen with one click (task-20-3): shows handles to change its length; a double click opens the request
  const [chosenVisit, setChosenVisit] = useState<string | null>(null);
  // Saving a move: on success the server refreshes the board data, the pending move is cleared here
  const [, moveAction, moving] = useActionState(async (previous: FormState, formData: FormData) => {
    const result = await rescheduleVisit(previous, formData);
    if (result.status === "success") {
      setMove(null);
      setNotice(result.message ?? "");
    } else {
      setMove((current) => current && { ...current, error: result.message ?? "Speichern fehlgeschlagen." });
    }
    return result;
  }, initialFormState);
  // A drag ends with a click on the lane below; that click must not pick a new slot
  const suppressClick = useRef(false);
  // Keyboard moves re-render the selection in another lane; focus follows it
  const focusPick = useRef(false);
  useEffect(() => {
    if (!focusPick.current) return;
    focusPick.current = false;
    document.querySelector<HTMLElement>(".plan3__blk--pick")?.focus();
  }, [pick]);
  const now = useMemo(() => new Date(availability.now), [availability.now]);
  const today = dayKeyOf(now);

  // Visits and absences of the shown days plus the suggestion window, each block once
  const allBusy = useMemo(() => {
    const seen = new Set<string>();
    const blocks: SlotBusy[] = [];
    for (const block of [...busy, ...availability.busy]) {
      // Holds of the phone assistant are shown, but do not block manual planning
      if (block.kind === "hold") continue;
      const key = `${block.technicianId}|${Date.parse(block.start)}|${Date.parse(block.end)}`;
      // The visit the customer wants to move does not block its own new time (task-20-16)
      if (props.change && key === `${props.change.visit.technicianId}|${Date.parse(props.change.visit.start)}|${Date.parse(props.change.visit.end)}`) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ technicianId: block.technicianId, start: block.start, end: block.end, kind: block.kind });
    }
    return blocks;
  }, [busy, availability.busy, props.change]);

  const suggestions = useMemo(() => request && props.suggest
    ? suggestSlots({ technicians, workingHours, busy: availability.busy, days: availability.days, now, durationMinutes: duration, experience: availability.experience })
    : [], [request, props.suggest, technicians, workingHours, availability, now, duration]);

  const techName = (id: string) => technicians.find((tech) => tech.id === id)?.name ?? "Unbekannt";

  function check(candidate: BoardPick, ignore: Ignore | null = null): { ok: boolean; message: string } {
    if (!isDayKey(candidate.day) || !isTime(candidate.start) || !isTime(candidate.end)) return { ok: false, message: "Bitte Datum, Beginn und Ende angeben." };
    const start = toMinutes(candidate.start);
    const end = toMinutes(candidate.end);
    if (end <= start) return { ok: false, message: "Ende muss nach dem Beginn liegen." };
    const hours = hoursOn(workingHours, candidate.technicianId, candidate.day);
    if (hours.length === 0) return { ok: false, message: `${techName(candidate.technicianId)} hat an diesem Tag keine Arbeitszeit.` };
    if (!hours.some((row) => toMinutes(row.start) <= start && toMinutes(row.end) >= end)) {
      return { ok: false, message: `Außerhalb der Arbeitszeit ${hours.map((row) => `${row.start}–${row.end}`).join(", ")}.` };
    }
    const from = berlinToInstant(candidate.day, candidate.start).getTime();
    const to = berlinToInstant(candidate.day, candidate.end).getTime();
    if (from < now.getTime()) return { ok: false, message: "Beginn liegt in der Vergangenheit." };
    const hit = allBusy.find((block) => block.technicianId === candidate.technicianId && Date.parse(block.start) < to && Date.parse(block.end) > from
      && !(ignore && block.technicianId === ignore.technicianId && Date.parse(block.start) === ignore.start && Date.parse(block.end) === ignore.end));
    if (hit) {
      const own = busy.find((block) => block.technicianId === hit.technicianId && Date.parse(block.start) === Date.parse(hit.start) && block.requestNumber);
      const what = hit.kind === "absence" ? "einer Abwesenheit" : own ? `Einsatz ${own.requestNumber}` : "einem anderen Einsatz";
      // Absences usually span whole days; their clock times (00:00–00:00) say nothing
      const withinDay = dayKeyOf(new Date(hit.start)) === candidate.day && dayKeyOf(new Date(Date.parse(hit.end) - 1)) === candidate.day;
      const span = withinDay ? `${toTime(minutesOfDay(new Date(hit.start)))}–${toTime(minutesOfDay(new Date(hit.end)))}` : "ganztägig";
      return { ok: false, message: `Überschneidet sich mit ${what} (${span}).` };
    }
    return { ok: true, message: `Frei · ${techName(candidate.technicianId)}, ${longDay(candidate.day)}, ${candidate.start}–${candidate.end}` };
  }

  // Earliest free window of the duration on one day, starting at or after the given minute
  function windowFrom(technicianId: string, day: string, fromMinute: number, span = duration, ignore: Ignore | null = null): BoardPick | null {
    for (const row of hoursOn(workingHours, technicianId, day)) {
      for (let minute = Math.max(toMinutes(row.start), fromMinute); minute + span <= toMinutes(row.end); minute += 30) {
        if (minute % 30 !== 0) continue;
        const candidate = { technicianId, day, start: toTime(minute), end: toTime(minute + span) };
        if (check(candidate, ignore).ok) return candidate;
      }
    }
    return null;
  }

  function href(overrides: { view?: "woche" | "tag"; anchor?: string; day?: string; pick?: BoardPick | null; duration?: number }) {
    const nextView = overrides.view ?? view;
    const nextPick = overrides.pick === undefined ? pick : overrides.pick;
    const query = new URLSearchParams();
    if (nextView === "tag") { query.set("ansicht", "tag"); query.set("tag", overrides.day ?? focusDay); }
    else query.set("woche", overrides.anchor ?? anchor);
    if (request) query.set("anfrage", request.id);
    query.set("dauer", String(overrides.duration ?? duration));
    if (nextPick) { query.set("techniker", nextPick.technicianId); query.set("datum", nextPick.day); query.set("beginn", nextPick.start); }
    return `/dashboard/planung?${query.toString()}`;
  }

  function choose(next: BoardPick | null, options: { notice?: string; syncForm?: boolean; nextDuration?: number } = {}) {
    setPick(next);
    setNotice(options.notice ?? "");
    if (options.syncForm !== false) setFormKey((key) => key + 1);
    window.history.replaceState(null, "", href({ pick: next, duration: options.nextDuration }));
  }

  function navigate(target: Parameters<typeof href>[0]) {
    startNavigation(() => router.push(href(target), { scroll: false }));
  }

  // Form edits update the board without remounting the form
  function onFormChange(event: FormEvent<HTMLDivElement>) {
    const form = event.currentTarget.closest("form");
    if (!form) return;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const next = { technicianId: value("technician_id"), day: value("date"), start: value("start"), end: value("end") };
    if (!next.technicianId || !isDayKey(next.day) || !isTime(next.start) || !isTime(next.end)) return;
    if ((event.target as HTMLElement).getAttribute("name") === "start") {
      next.end = toTime(Math.min(toMinutes(next.start) + duration, 23 * 60 + 30));
      const end = form.elements.namedItem("end") as HTMLInputElement | null;
      if (end) end.value = next.end;
    }
    // A different end in the form changes the length like the handles (task-20-5)
    const span = toMinutes(next.end) - toMinutes(next.start);
    if (span >= 2 * DRAG_STEP && span !== duration) {
      setDuration(span);
      return choose(next, { syncForm: false, nextDuration: span });
    }
    choose(next, { syncForm: false });
  }

  // Bounds of the lanes (week and day view): the working hours of the shown days in whole hours, widened
  // only where a visit lies outside them, so no space is spent on hours that cannot be booked
  const bounds = useMemo(() => {
    const starts: number[] = [];
    const ends: number[] = [];
    for (const day of days) {
      for (const tech of technicians) {
        for (const row of hoursOn(workingHours, tech.id, day)) { starts.push(toMinutes(row.start)); ends.push(toMinutes(row.end)); }
      }
      for (const block of busy) {
        if (block.kind !== "visit" || dayKeyOf(new Date(block.start)) !== day || dayKeyOf(new Date(block.end)) !== day) continue;
        starts.push(minutesOfDay(new Date(block.start)));
        ends.push(minutesOfDay(new Date(block.end)));
      }
    }
    if (starts.length === 0) return { from: 7 * 60, to: 17 * 60 };
    return { from: Math.floor(Math.min(...starts) / 60) * 60, to: Math.ceil(Math.max(...ends) / 60) * 60 };
  }, [days, technicians, workingHours, busy]);
  const pct = (minutes: number) => ((Math.min(Math.max(minutes, bounds.from), bounds.to) - bounds.from) / (bounds.to - bounds.from)) * 100;
  const place = (start: number, end: number) => ({ left: `${pct(start)}%`, width: `calc(${pct(end) - pct(start)}% - 2px)` });
  // A thin line at every full hour inside the lanes (as in the draft), independent of the labels
  const hourLines: number[] = [];
  for (let minute = Math.ceil((bounds.from + 1) / 60) * 60; minute < bounds.to; minute += 60) hourLines.push(minute);
  // Lighter half-hour lines only in the day view; in the narrow week cells they would be a few pixels apart
  const halfHourLines: number[] = [];
  if (view === "tag") for (let minute = bounds.from + 30; minute < bounds.to; minute += 60) halfHourLines.push(minute);
  // Day view: every two hours; narrow week cells: start, a full hour in the middle, end
  const ticks: number[] = [];
  if (view === "tag") for (let minute = bounds.from; minute <= bounds.to; minute += bounds.to - bounds.from > 12 * 60 ? 120 : 60) ticks.push(minute);
  else ticks.push(bounds.from, Math.round((bounds.from + bounds.to) / 120) * 60, bounds.to);

  function segmentsOf(technicianId: string, day: string): Segment[] {
    return busy
      .filter((block) => block.technicianId === technicianId && dayKeyOf(new Date(block.start)) <= day && dayKeyOf(new Date(Date.parse(block.end) - 1)) >= day)
      .map((block) => {
        const start = dayKeyOf(new Date(block.start)) < day ? 0 : minutesOfDay(new Date(block.start));
        const end = dayKeyOf(new Date(block.end)) > day ? 24 * 60 : minutesOfDay(new Date(block.end));
        const kind = block.kind === "absence" ? "absence" : block.kind === "hold" ? "hold" : block.requestNumber ? "own" : "busy";
        const label = kind === "absence" ? "Abwesend" : kind === "hold" ? holdLabel(block) : block.requestNumber ?? "Belegt";
        const unreadSuffix = (block.unread ? ` · ${unreadText(block.unread)}` : "") + (block.change ? (block.change.state === "offered" ? " · Vorschlag gesendet, Kunde antwortet noch" : " · Kunde möchte verschieben") : "");
        return { start, end, kind, label: label + unreadSuffix, block };
      });
  }

  // Monthly load next to the name (task-12-1): "Okt. · 22 % belegt", details in the tooltip
  // Fixed names instead of Intl, so server and browser render the same text
  const monthIndex = Number(props.monthLoads.month.slice(5, 7)) - 1;
  const monthShort = MONTH_SHORT[monthIndex];
  const monthLong = `${MONTH_LONG[monthIndex]} ${props.monthLoads.month.slice(0, 4)}`;
  const hoursText = (minutes: number) => `${Math.round(minutes / 60).toLocaleString("de-DE")} h`;
  function loadLabel(technicianId: string) {
    const load = props.monthLoads.loads[technicianId];
    if (!load || load.kind === "none") return null;
    if (load.kind === "absent") return { percent: null, title: `${monthLong}: den ganzen Monat abwesend` };
    const absent = load.absentDays > 0 ? ` · davon ${load.absentDays} ${load.absentDays === 1 ? "Tag" : "Tage"} abwesend` : "";
    return { percent: load.percent, title: `${monthLong}: ${hoursText(load.plannedMinutes)} von ${hoursText(load.capacityMinutes)} Arbeitszeit eingeplant${absent}` };
  }

  const live = drag && !drag.ignore ? drag.snapped : pick;
  const pickCheck = live ? check(live) : null;
  const moveCheck = drag?.ignore ? check(drag.snapped, drag.ignore) : move ? check(move.to, ignoreOf(move.block)) : null;
  const dragCheck = drag?.ignore ? moveCheck : pickCheck;

  // Drag with mouse, pen or finger; listeners on window so the pointer may leave the lane. Without a visit it moves
  // the selection (task-10-7), with a visit that visit (task-10-8, saved only after confirmation)
  function startDrag(event: ReactPointerEvent<HTMLElement>, origin: BoardPick | null, visit: BusyBlock | null = null) {
    if (!origin || (event.pointerType === "mouse" && event.button !== 0)) return;
    const laneElement = event.currentTarget.closest<HTMLElement>(".plan3__lane");
    if (!laneElement) return;
    event.preventDefault();
    event.stopPropagation();
    const ignore = visit ? ignoreOf(visit) : null;
    const span = toMinutes(origin.end) - toMinutes(origin.start);
    const minuteIn = (element: HTMLElement, clientX: number) => {
      const rect = element.getBoundingClientRect();
      return bounds.from + ((clientX - rect.left) / rect.width) * (bounds.to - bounds.from);
    };
    const offset = minuteIn(laneElement, event.clientX) - toMinutes(origin.start);
    const startX = event.clientX;
    const startY = event.clientY;
    let current: Drag | null = null;

    const move = (moveEvent: PointerEvent) => {
      if (!current && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>(".plan3__lane[data-tech][data-day]");
      const technicianId = under?.dataset.tech ?? current?.technicianId ?? origin.technicianId;
      const day = under?.dataset.day ?? current?.day ?? origin.day;
      const target = under ?? document.querySelector<HTMLElement>(`.plan3__lane[data-tech="${technicianId}"][data-day="${day}"]`);
      if (!target) return;
      const exact = Math.min(Math.max(minuteIn(target, moveEvent.clientX) - offset, bounds.from), bounds.to - span);
      const start = Math.min(Math.max(Math.round(exact / DRAG_STEP) * DRAG_STEP, bounds.from), bounds.to - span);
      current = { technicianId, day, x: moveEvent.clientX, y: moveEvent.clientY, ignore, snapped: { technicianId, day, start: toTime(start), end: toTime(start + span) } };
      setDrag(current);
    };
    const stop = (dropIt: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("is-plan-dragging");
      setDrag(null);
      if (!current) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (dropIt) {
        if (visit) dropVisit(visit, current.snapped);
        else drop(current.snapped, origin);
      }
    };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.body.classList.add("is-plan-dragging");
  }

  // Handle of a chosen visit (task-20-3) or of the selection (task-20-5): drags its start or end on the 15-minute grid,
  // at least 30 minutes long. A visit goes to the same confirmation as a move, the selection takes the new length
  function startResize(event: ReactPointerEvent<HTMLElement>, edge: "start" | "end", visit: BusyBlock | null) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const laneElement = event.currentTarget.closest<HTMLElement>(".plan3__lane");
    if (!laneElement || (visit ? !visit.move : !pick)) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = visit ? (move && move.visitId === visit.move!.visitId ? move.to : pickOf(visit)) : pick!;
    const ignore = visit ? ignoreOf(visit) : null;
    const startX = event.clientX;
    let current: Drag | null = null;
    const move_ = (moveEvent: PointerEvent) => {
      if (!current && Math.abs(moveEvent.clientX - startX) < 3) return;
      const rect = laneElement.getBoundingClientRect();
      const minute = Math.round((bounds.from + ((moveEvent.clientX - rect.left) / rect.width) * (bounds.to - bounds.from)) / DRAG_STEP) * DRAG_STEP;
      let start = toMinutes(origin.start);
      let end = toMinutes(origin.end);
      if (edge === "start") start = Math.min(Math.max(minute, bounds.from), end - 2 * DRAG_STEP);
      else end = Math.max(Math.min(minute, bounds.to), start + 2 * DRAG_STEP);
      current = { technicianId: origin.technicianId, day: origin.day, x: moveEvent.clientX, y: moveEvent.clientY, ignore, snapped: { ...origin, start: toTime(start), end: toTime(end) } };
      setDrag(current);
    };
    const stop = (dropIt: boolean) => {
      window.removeEventListener("pointermove", move_);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("is-plan-resizing");
      setDrag(null);
      if (!current) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (!dropIt) return;
      if (visit) dropVisit(visit, current.snapped, true);
      else resizePick(current.snapped);
    };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);
    window.addEventListener("pointermove", move_);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.body.classList.add("is-plan-resizing");
  }

  // Dropped on a free slot: take it; on a conflict: the next free window of that day, else keep the old selection
  function drop(candidate: BoardPick, origin: BoardPick) {
    const result = check(candidate);
    if (result.ok) return choose(candidate);
    const found = windowFrom(candidate.technicianId, candidate.day, toMinutes(candidate.start)) ?? windowFrom(candidate.technicianId, candidate.day, 0);
    if (found) return choose(found, { notice: `${result.message} Nächstes freies Fenster übernommen: ${found.start}–${found.end}.` });
    choose(origin, { notice: `${result.message} Kein freies Fenster für ${durationText(duration)} an diesem Tag – Auswahl unverändert.` });
  }

  // Selection with a new length (task-20-5): free → taken, the suggestions follow the length; conflict → unchanged
  function resizePick(candidate: BoardPick) {
    const result = check(candidate);
    if (!result.ok) return setNotice(`${result.message} Länge unverändert.`);
    const span = toMinutes(candidate.end) - toMinutes(candidate.start);
    setDuration(span);
    choose(candidate, { nextDuration: span });
  }

  // Planned visit dropped: free target → confirmation; conflict → next free window of the same length that day
  function dropVisit(visit: BusyBlock, candidate: BoardPick, resized = false) {
    if (!visit.move) return;
    const from = pickOf(visit);
    const ignore = ignoreOf(visit);
    const pending = (to: BoardPick, text = "") => {
      setNotice(text);
      if (to.technicianId === from.technicianId && to.day === from.day && to.start === from.start && to.end === from.end) return setMove(null);
      setMove({ block: visit, visitId: visit.move!.visitId, version: visit.move!.version, from, to });
    };
    const result = check(candidate, ignore);
    if (result.ok) return pending(candidate);
    // A changed length stays where it is: the next free window of another length would surprise
    if (resized) return setNotice(`${result.message} Länge unverändert.`);
    const span = toMinutes(from.end) - toMinutes(from.start);
    const found = windowFrom(candidate.technicianId, candidate.day, toMinutes(candidate.start), span, ignore) ?? windowFrom(candidate.technicianId, candidate.day, 0, span, ignore);
    if (found) return pending(found, `${result.message} Nächstes freies Fenster vorgeschlagen: ${found.start}–${found.end}.`);
    setNotice(`${result.message} Kein freies Fenster für diesen Einsatz an diesem Tag – Einsatz unverändert.`);
  }

  // Keyboard on a planned visit: ←/→ 15 minutes, ↑/↓ technician (pending move), Enter opens the request, Esc cancels
  function visitKey(event: ReactKeyboardEvent<HTMLElement>, visit: BusyBlock) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (visit.requestId) router.push(`/dashboard/anfragen/${visit.requestId}`);
      return;
    }
    if (event.key === "Escape") { setMove(null); setChosenVisit(null); return; }
    const base = move && move.visitId === visit.move?.visitId ? move.to : pickOf(visit);
    const span = toMinutes(base.end) - toMinutes(base.start);
    let next: BoardPick | null = null;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Shift + ←/→: length by 15 minutes (task-20-3), at least 30 minutes
      const end = Math.min(Math.max(toMinutes(base.end) + (event.key === "ArrowLeft" ? -DRAG_STEP : DRAG_STEP), toMinutes(base.start) + 2 * DRAG_STEP), bounds.to);
      next = { ...base, end: toTime(end) };
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const start = Math.min(Math.max(toMinutes(base.start) + (event.key === "ArrowLeft" ? -DRAG_STEP : DRAG_STEP), bounds.from), bounds.to - span);
      next = { ...base, start: toTime(start), end: toTime(start + span) };
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const index = technicians.findIndex((tech) => tech.id === base.technicianId) + (event.key === "ArrowUp" ? -1 : 1);
      if (index >= 0 && index < technicians.length) next = { ...base, technicianId: technicians[index].id };
    }
    if (!next || !visit.move) return;
    event.preventDefault();
    event.stopPropagation();
    const from = pickOf(visit);
    setNotice("");
    if (next.technicianId === from.technicianId && next.start === from.start && next.end === from.end) return setMove(null);
    setMove({ block: visit, visitId: visit.move.visitId, version: visit.move.version, from, to: next });
  }

  // Keyboard alternative: ←/→ move by 15 minutes, ↑/↓ switch the technician (same day and time)
  function keyMove(event: ReactKeyboardEvent<HTMLElement>) {
    if (!pick) return;
    if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); event.preventDefault(); return; }
    const span = toMinutes(pick.end) - toMinutes(pick.start);
    let next: BoardPick | null = null;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Shift + ←/→: length by 15 minutes (task-20-5), at least 30 minutes
      const end = Math.min(Math.max(toMinutes(pick.end) + (event.key === "ArrowLeft" ? -DRAG_STEP : DRAG_STEP), toMinutes(pick.start) + 2 * DRAG_STEP), bounds.to);
      event.preventDefault();
      event.stopPropagation();
      focusPick.current = true;
      return resizePick({ ...pick, end: toTime(end) });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const start = Math.min(Math.max(toMinutes(pick.start) + (event.key === "ArrowLeft" ? -DRAG_STEP : DRAG_STEP), bounds.from), bounds.to - span);
      next = { ...pick, start: toTime(start), end: toTime(start + span) };
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const index = technicians.findIndex((tech) => tech.id === pick.technicianId) + (event.key === "ArrowUp" ? -1 : 1);
      if (index >= 0 && index < technicians.length) next = { ...pick, technicianId: technicians[index].id };
    }
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    focusPick.current = true;
    choose(next);
  }
  const canPick = Boolean(request);
  const hasMovable = busy.some((block) => block.move !== null);
  const rangeLabel = view === "tag" ? longDay(focusDay) : `KW ${isoWeek(days[0])}${isoWeek(days[days.length - 1]) !== isoWeek(days[0]) ? `/${isoWeek(days[days.length - 1])}` : ""}`;
  const rangeDates = view === "tag" ? `KW ${isoWeek(focusDay)}` : `${shortDay(days[0])} – ${shortDay(days[days.length - 1])}`;
  // Panel for a customer's wish to move a visit (task-20-16): options on the board, then confirm, offer or close
  function renderChangePanel() {
    const change = props.change!;
    const options = [
      ...(change.wished.free && change.wished.start && change.wished.end ? [{ label: "Wunschtermin", technicianId: change.wished.technicianId, start: change.wished.start, end: change.wished.end }] : []),
      ...change.alternatives.map((alt, index) => ({ label: `Alternative ${index + 1}`, technicianId: alt.technicianId, start: alt.start, end: alt.end })),
    ].map((option) => ({ ...option, day: dayKeyOf(new Date(option.start)), from: toTime(minutesOfDay(new Date(option.start))), to: toTime(minutesOfDay(new Date(option.end))) }));
    const ready = Boolean(pick && pickCheck?.ok);
    const hidden = (name: string, value: string | number) => <HiddenField name={name} value={value} />;
    const fields = (
      <>
        {hidden("change_id", change.id)}
        {hidden("version", request?.version ?? 0)}
        {hidden("technician_id", pick?.technicianId ?? "")}
        {hidden("date", pick?.day ?? "")}
        {hidden("start", pick?.start ?? "")}
        {hidden("end", pick?.end ?? "")}
      </>
    );
    return (
      <>
        <div className="plan3__panel-sec">
          <h3 className="plan3__eyebrow">{change.wished.free ? "Wunschtermin und Alternativen" : "Alternativen zum Wunschtermin"}</h3>
          {options.length === 0 ? (
            <p className="plan3__muted">Keine freie Zeit in den nächsten zwei Wochen. Eine freie Fläche in der Plantafel anklicken und den Zeitraum ziehen.</p>
          ) : (
            <ul className="plan3__sugs">
              {options.map((option, index) => {
                const active = pick?.technicianId === option.technicianId && pick.day === option.day && pick.start === option.from && pick.end === option.to;
                return (
                  <li key={`${option.start}-${option.technicianId}`}>
                    <button type="button" className="plan3__sug" aria-pressed={active}
                      onClick={() => {
                        const next = { technicianId: option.technicianId, day: option.day, start: option.from, end: option.to };
                        if (view === "woche" && !days.includes(next.day)) { setPick(next); setFormKey((key) => key + 1); navigate({ anchor: next.day, pick: next }); }
                        else if (view === "tag" && next.day !== focusDay) { setPick(next); setFormKey((key) => key + 1); navigate({ day: next.day, pick: next }); }
                        else choose(next);
                      }}>
                      <span className="plan3__rank" aria-hidden="true">{index + 1}</span>
                      <strong>{techName(option.technicianId)}</strong>
                      <span className="mono">{shortDay(option.day)} · {option.from}–{option.to}</span>
                      <span className="plan3__why">{option.label}{option.technicianId !== change.visit.technicianId ? " · anderer Techniker" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!change.wished.free && <p className="plan3__muted">Zum Wunschtermin ist {techName(change.visit.technicianId)} nicht frei.</p>}
        </div>
        <div className="plan3__panel-sec">
          <h3 className="plan3__eyebrow">Auswahl</h3>
          <p className={`plan3__check plan3__check--${pickCheck ? (pickCheck.ok ? "ok" : "bad") : "none"}`} aria-live="polite">
            <Icon name={pickCheck ? (pickCheck.ok ? "check-circle" : "alert") : "calendar"} size={18} />
            <span>{pickCheck ? pickCheck.message : "Noch nichts gewählt: eine Option oder eine freie Fläche in der Plantafel anklicken, die Auswahl lässt sich ziehen."}</span>
          </p>
          <SaveForm key={`confirm-${formKey}`} action={confirmVisitChange} submitLabel="Verschieben und bestätigen" submitDisabled={!ready} className="plan3__form">
            {fields}
            <p className="plan3__muted">Der Termin wird verschoben, der Kunde erhält die Bestätigung mit dem neuen Termin.</p>
          </SaveForm>
          <SaveForm key={`offer-${formKey}`} action={offerVisitChange} submitLabel={change.state === "offered" ? "Neuen Vorschlag senden" : "Als Vorschlag senden"} submitVariant="secondary" submitDisabled={!ready} className="plan3__form">
            {fields}
            <p className="plan3__muted">Der Termin bleibt. Der Kunde bekommt den Vorschlag per E-Mail und antwortet mit Ja oder Nein; bei Ja wird der Termin automatisch verschoben.</p>
          </SaveForm>
          <SaveForm key={`close-${formKey}`} action={closeVisitChange} submitLabel="Wunsch ohne E-Mail erledigen" submitVariant="secondary" className="plan3__form">
            {hidden("change_id", change.id)}
            <p className="plan3__muted">Wenn der Wunsch anders geklärt wurde (z. B. am Telefon).</p>
          </SaveForm>
        </div>
      </>
    );
  }

  const unit = view === "tag" ? { prev: "Vorheriger Tag", next: "Nächster Tag" } : { prev: "Vorherige Woche", next: "Nächste Woche" };
  const todayWorkday = isoWeekday(today) > 5 ? nextWorkday(today, 1) : today;

  function lane(technicianId: string, day: string) {
    const hours = hoursOn(workingHours, technicianId, day);
    const segments = segmentsOf(technicianId, day);
    const absentAllDay = hours.length === 0 || segments.some((segment) => segment.kind === "absence" && segment.start <= toMinutes(hours[0].start) && segment.end >= toMinutes(hours[hours.length - 1].end));
    const firstWindow = canPick && !absentAllDay ? windowFrom(technicianId, day, 0) : null;
    const name = techName(technicianId);
    const busyText = segments.filter((segment) => segment.kind !== "absence" && segment.kind !== "hold").map((segment) => `${toTime(segment.start)}–${toTime(segment.end)}`).join(", ");
    const label = `${name}, ${shortDay(day)}: ${absentAllDay ? "nicht verfügbar" : `${busyText ? `belegt ${busyText}` : "frei"}${canPick ? (firstWindow ? `, frei ab ${firstWindow.start}` : `, kein freies Fenster für ${durationText(duration)}`) : ""}`}`;
    const pickHere = !drag && pick && pick.technicianId === technicianId && pick.day === day ? pick : null;
    // The selection still on a hold that deviates from the wish keeps that warning colour (task-20-13)
    const pickDeviates = pickHere && busy.some((block) => block.kind === "hold" && block.hold?.state === "deviates" && block.requestId === request?.id
      && block.technicianId === technicianId && dayKeyOf(new Date(block.start)) === day
      && toTime(minutesOfDay(new Date(block.start))) === pickHere.start && toTime(minutesOfDay(new Date(block.end))) === pickHere.end);
    const dragHere = drag && drag.technicianId === technicianId && drag.day === day ? drag : null;
    const moveHere = !drag && move && move.to.technicianId === technicianId && move.to.day === day ? move : null;
    const ghosts = suggestions
      .map((suggestion, index) => ({ suggestion, rank: index + 1 }))
      .filter(({ suggestion }) => suggestion.technicianId === technicianId && suggestion.day === day && !(pickHere && pickHere.start === suggestion.startTime && pickHere.end === suggestion.endTime));

    const select = (clientX: number | null, target: HTMLElement) => {
      if (!canPick) return;
      let from = 0;
      if (clientX !== null) {
        const rect = target.getBoundingClientRect();
        // Nearest half hour in the week view (a lane is only ~80 px wide, one pixel is several minutes); quarter hour
        // in the day view like dragging (task-19-4)
        const step = view === "tag" ? DRAG_STEP : 30;
        from = Math.round((bounds.from + ((clientX - rect.left) / rect.width) * (bounds.to - bounds.from)) / step) * step;
        const lastStart = Math.max(...hours.map((row) => toMinutes(row.end))) - duration;
        from = Math.min(from, lastStart);
      }
      const exact = clientX !== null ? { technicianId, day, start: toTime(from), end: toTime(from + duration) } : null;
      if (exact && check(exact).ok) return choose(exact);
      const found = windowFrom(technicianId, day, from) ?? windowFrom(technicianId, day, 0);
      if (!found) return setNotice(`${name} hat am ${shortDay(day)} kein freies Fenster für ${durationText(duration)}.`);
      choose(found, { notice: clientX !== null ? `Nächstes freies Fenster übernommen: ${found.start}–${found.end}.` : "" });
    };

    const interactive = canPick && !absentAllDay;
    return (
      <div
        className={`plan3__lane${absentAllDay ? " is-off" : ""}${interactive ? " is-pickable" : ""}${dragHere ? " is-drop" : ""}`}
        data-tech={technicianId}
        data-day={day}
        data-from={bounds.from}
        data-to={bounds.to}
        role={interactive ? "button" : "img"}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? `${label}. Auswählen` : label}
        onClick={(event) => { if (suppressClick.current) return; setChosenVisit(null); if (interactive) select(event.clientX, event.currentTarget); }}
        onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(null, event.currentTarget); } } : undefined}
      >
        {halfHourLines.map((minute) => <i key={minute} className="plan3__grid plan3__grid--half" style={{ left: `${pct(minute)}%` }} />)}
        {hourLines.map((minute) => <i key={minute} className="plan3__grid" style={{ left: `${pct(minute)}%` }} />)}
        {hours.length > 0 && toMinutes(hours[0].start) > bounds.from && <i className="plan3__blk plan3__blk--outside" style={{ left: 0, width: `${pct(toMinutes(hours[0].start))}%` }} />}
        {hours.length > 0 && toMinutes(hours[hours.length - 1].end) < bounds.to && <i className="plan3__blk plan3__blk--outside" style={{ left: `${pct(toMinutes(hours[hours.length - 1].end))}%`, right: 0 }} />}
        {day <= today && !absentAllDay && <i className="plan3__blk plan3__blk--past" style={{ left: 0, width: day < today ? "100%" : `${pct(minutesOfDay(now))}%` }} />}
        {absentAllDay
          ? <span className="plan3__off-label">{hours.length === 0 ? "Keine Arbeitszeit" : "Abwesend"}</span>
          : segments.map((segment) => {
            const span = `${toTime(segment.start)}–${toTime(Math.min(segment.end, 24 * 60 - 1))}`;
            const text = view === "tag" && <span className="plan3__blk-text">{segment.label} · {span}</span>;
            const visit = segment.block;
            // Planned visits within one day may be dragged (task-10-8); the original stays faded while it is moved
            const movable = visit.move !== null && dayKeyOf(new Date(visit.start)) === day && dayKeyOf(new Date(Date.parse(visit.end) - 1)) === day;
            // Colours by time (task-20-3): coming visits blue, past ones dark grey
            const past = segment.kind === "own" && Date.parse(visit.end) <= now.getTime() ? " is-past" : "";
            if (!movable) {
              const holdState = segment.kind === "hold" ? visit.hold?.state : undefined;
              return (
                <span key={`${segment.start}-${segment.end}`} className={`plan3__blk plan3__blk--${segment.kind}${past}${holdState ? ` is-${holdState}` : ""}${visit.change ? " has-change" : ""}`}
                  style={place(segment.start, segment.end)} title={`${segment.label} · ${span}`} data-hold-state={holdState}>
                  {text || (holdState && HOLD_MARK[holdState] && <span className="plan3__blk-mark" aria-hidden="true">{HOLD_MARK[holdState]}</span>)}
                </span>
              );
            }
            const isMoving = move?.visitId === visit.move?.visitId || (drag?.ignore?.start === Date.parse(visit.start) && drag.ignore.technicianId === visit.technicianId);
            const chosen = chosenVisit === visit.move?.visitId && !isMoving;
            return (
              <span
                key={`${segment.start}-${segment.end}`}
                className={`plan3__blk plan3__blk--own is-movable${past}${isMoving ? " is-moving" : ""}${chosen ? " is-chosen" : ""}${visit.change ? " has-change" : ""}`}
                style={place(segment.start, segment.end)}
                title={`${segment.label} · ${span} · Klick: auswählen und Länge ändern, ziehen: verschieben, Doppelklick: Anfrage öffnen`}
                role="button"
                tabIndex={0}
                data-visit={visit.move?.visitId}
                aria-pressed={chosen}
                aria-label={`Einsatz ${segment.label}, ${name}, ${shortDay(day)} ${span}. Ziehen oder mit Pfeiltasten verschieben, Umschalt und Pfeiltasten ändern die Länge, Enter öffnet die Anfrage.`}
                onPointerDown={(event) => startDrag(event, pickOf(visit), visit)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!suppressClick.current) setChosenVisit(chosen ? null : visit.move?.visitId ?? null);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (visit.requestId) router.push(`/dashboard/anfragen/${visit.requestId}`);
                }}
                onKeyDown={(event) => visitKey(event, visit)}
              >
                {text}
                {chosen && <>
                  <i className="plan3__handle plan3__handle--start" aria-hidden="true" onPointerDown={(event) => startResize(event, "start", visit)} />
                  <i className="plan3__handle plan3__handle--end" aria-hidden="true" onPointerDown={(event) => startResize(event, "end", visit)} />
                </>}
              </span>
            );
          })}
        {/* Unread customer messages (task-20-14): red circle with the count at the top right of the block */}
        {!absentAllDay && segments.filter((segment) => (segment.block.unread ?? 0) > 0).map((segment) => (
          <span key={`unread-${segment.start}-${segment.end}`} className="plan3__badge" style={{ left: `${pct(Math.min(segment.end, bounds.to))}%` }} aria-hidden="true">{segment.block.unread}</span>
        ))}
        {/* Wish of the customer to move the visit (task-20-16): a marker that opens the wish in the panel */}
        {!absentAllDay && segments.filter((segment) => segment.block.change && segment.block.requestId).map((segment) => (
          <button key={`change-${segment.start}-${segment.end}`} type="button" className={`plan3__change plan3__change--${segment.block.change!.state}`}
            style={{ left: `${pct(segment.start)}%` }} title={segment.block.change!.state === "offered" ? "Vorschlag gesendet, der Kunde antwortet noch – Wunsch öffnen" : "Der Kunde möchte den Termin verschieben – Wunsch öffnen"}
            aria-label={`Verschiebewunsch ${segment.block.requestNumber ?? ""} öffnen`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); router.push(`/dashboard/planung?anfrage=${segment.block.requestId}`, { scroll: false }); }}>
            <Icon name="calendar" size={11} />
          </button>
        ))}
        {moveHere && (
          <span
            className={`plan3__blk plan3__blk--own plan3__blk--moveto${moveCheck?.ok ? "" : " is-conflict"}`}
            style={place(toMinutes(moveHere.to.start), toMinutes(moveHere.to.end))}
            title={`Neu: ${moveHere.to.start}–${moveHere.to.end}`}
            onPointerDown={(event) => startDrag(event, moveHere.to, moveHere.block)}
            onClick={(event) => event.stopPropagation()}
          >
            {view === "tag" && <span className="plan3__blk-text">{moveHere.block.requestNumber} · {moveHere.to.start}–{moveHere.to.end}</span>}
            {/* The handles stay on the pending change (task-20-5), so a wrong length can be corrected at once */}
            <i className="plan3__handle plan3__handle--start" aria-hidden="true" onPointerDown={(event) => startResize(event, "start", moveHere.block)} />
            <i className="plan3__handle plan3__handle--end" aria-hidden="true" onPointerDown={(event) => startResize(event, "end", moveHere.block)} />
          </span>
        )}
        {ghosts.map(({ suggestion, rank }) => (
          // A click on a suggestion takes it exactly (task-20-5), wherever inside it the click lands
          <span key={rank} className="plan3__blk plan3__blk--sug" style={place(toMinutes(suggestion.startTime), toMinutes(suggestion.endTime))} aria-hidden="true"
            title={`Vorschlag ${rank}: ${suggestion.startTime}–${suggestion.endTime} übernehmen`}
            onClick={(event) => {
              event.stopPropagation();
              if (suppressClick.current) return;
              setChosenVisit(null);
              choose({ technicianId, day, start: suggestion.startTime, end: suggestion.endTime });
            }}>{rank}</span>
        ))}
        {pickHere && (
          <span
            className={`plan3__blk plan3__blk--pick${pickCheck?.ok ? "" : " is-conflict"}${pickDeviates ? " is-deviates" : ""}`}
            style={place(toMinutes(pickHere.start), toMinutes(pickHere.end))}
            role="button"
            tabIndex={0}
            title={pickDeviates ? "Vorgemerkt, abweichend vom Wunsch: mit dem Kunden abstimmen" : undefined}
            aria-label={`Auswahl ${name}, ${shortDay(day)} ${pickHere.start}–${pickHere.end}${pickDeviates ? ", abweichend vom Kundenwunsch" : ""}. Ziehen oder mit Pfeiltasten verschieben, Griffe an den Rändern oder Umschalt und Pfeiltasten ändern die Länge.`}
            onPointerDown={(event) => startDrag(event, pick)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={keyMove}
          >
            {(view === "tag" || toMinutes(pickHere.end) - toMinutes(pickHere.start) >= 120) && <span className="plan3__blk-text">{pickHere.start}–{pickHere.end}</span>}
            {/* At the edge of the lane the handle moves inside, otherwise the lane would cut it off */}
            <i className={`plan3__handle plan3__handle--pick plan3__handle--start${toMinutes(pickHere.start) <= bounds.from ? " is-inside" : ""}`} aria-hidden="true" onPointerDown={(event) => startResize(event, "start", null)} />
            <i className={`plan3__handle plan3__handle--pick plan3__handle--end${toMinutes(pickHere.end) >= bounds.to ? " is-inside" : ""}`} aria-hidden="true" onPointerDown={(event) => startResize(event, "end", null)} />
          </span>
        )}
        {dragHere && (
          <span className={`plan3__blk ${dragHere.ignore ? "plan3__blk--own plan3__blk--moveto" : "plan3__blk--pick"} is-dragging${dragCheck?.ok ? "" : " is-conflict"}`} style={place(toMinutes(dragHere.snapped.start), toMinutes(dragHere.snapped.end))} aria-hidden="true">
            {(view === "tag" || toMinutes(dragHere.snapped.end) - toMinutes(dragHere.snapped.start) >= 120) && <span className="plan3__blk-text">{dragHere.snapped.start}–{dragHere.snapped.end}</span>}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <span hidden data-dashboard-dirty={Boolean(drag || move || chosenVisit || duration !== props.initialDuration || JSON.stringify(pick) !== JSON.stringify(props.initialPick))}
        data-dashboard-busy={Boolean(drag || moving || navigating)} />
      <section id="woche" className="rw-card rw-card--neutral plan3__board" aria-labelledby="plantafel-title" aria-busy={navigating || undefined}>
        <header className="plan3__board-head">
          <div>
            <h2 id="plantafel-title" className="rw-card__title">Plantafel</h2>
            <p className="plan3__range"><strong>{rangeLabel}</strong> <span className="mono">{rangeDates}</span></p>
          </div>
          <div className="plan3__tools">
            <div className="plan3__seg" role="group" aria-label="Zeitraum wechseln">
              <button type="button" className="plan3__icon-btn" aria-label={unit.prev} title={unit.prev}
                onClick={() => navigate(view === "tag" ? { day: nextWorkday(focusDay, -1) } : { anchor: addDays(weekStart(anchor), -7) })}>
                <Icon name="arrow-left" size={16} />
              </button>
              <button type="button" onClick={() => navigate(view === "tag" ? { day: todayWorkday } : { anchor: todayWorkday })}>Heute</button>
              <button type="button" className="plan3__icon-btn" aria-label={unit.next} title={unit.next}
                onClick={() => navigate(view === "tag" ? { day: nextWorkday(focusDay, 1) } : { anchor: addDays(weekStart(anchor), 7) })}>
                <Icon name="arrow-right" size={16} />
              </button>
            </div>
            <div className="plan3__seg" role="group" aria-label="Ansicht">
              <button type="button" aria-pressed={view === "woche"} onClick={() => view !== "woche" && navigate({ view: "woche", anchor: focusDay })}>Woche</button>
              <button type="button" aria-pressed={view === "tag"} onClick={() => view !== "tag" && navigate({ view: "tag", day: pick && days.includes(pick.day) ? pick.day : days.includes(todayWorkday) ? todayWorkday : days[0] })}>Tag</button>
            </div>
          </div>
        </header>

        {view === "tag" && (
          <nav className="plan3__days" aria-label="Tag wählen">
            {nextWorkingDays(weekStart(focusDay), 5).map((day) => (
              <button key={day} type="button" aria-pressed={day === focusDay} onClick={() => day !== focusDay && navigate({ day })}>{shortDay(day)}</button>
            ))}
          </nav>
        )}

        <div className="plan3__references">
          <details className="plan3__reference">
            <summary>Legende</summary>
            <ul className="plan3__legend" aria-label="Legende">
              <li><i className="plan3__key plan3__key--own" />Einsätze</li>
              <li><i className="plan3__key plan3__key--own-past" />Einsätze, vorbei</li>
              <li><i className="plan3__key plan3__key--busy" />Belegt (andere)</li>
              <li><i className="plan3__key plan3__key--absence" />Abwesend</li>
              <li><i className="plan3__key plan3__key--hold is-wish" />Vorgemerkt: Wunschtermin</li>
              <li><i className="plan3__key plan3__key--hold is-deviates" />Vorgemerkt: abweichend vom Wunsch, abstimmen</li>
              <li><i className="plan3__key plan3__key--hold is-mira" />Vorgemerkt: mit Mira vereinbart</li>
              {canPick && props.suggest && <li><i className="plan3__key plan3__key--sug" />Vorschlag</li>}
              {canPick && <li><i className="plan3__key plan3__key--pick" />Auswahl</li>}
              <li><i className="plan3__key plan3__key--badge" />Ungelesene Nachricht vom Kunden</li>
              <li><i className="plan3__key plan3__key--change" />Kunde möchte den Termin verschieben</li>
              <li><i className="plan3__key plan3__key--past" />Vorbei</li>
              <li><i className="plan3__key plan3__key--outside" />Außerhalb der Arbeitszeit</li>
            </ul>
          </details>
          <details className="plan3__reference">
            <summary>Bedienung</summary>
            <p className="plan3__hint">
              {canPick
                ? <>{props.suggest ? "Vorschlag oder leere Fläche" : "Leere Fläche"} anklicken, die Auswahl ziehen (15-Minuten-Raster, auch zu anderem Techniker oder Tag; Pfeiltasten auf der Auswahl) und ihre Länge an den Rändern ändern (aktuell {durationText(duration)}). Jede Zeile zeigt <span className="mono">{toTime(bounds.from)}</span> bis <span className="mono">{toTime(bounds.to)}</span>.</>
                : "Links eine Anfrage wählen, dann lassen sich freie Flächen anklicken."}
              {hasMovable && " Geplante Einsätze: ziehen verschiebt; ein Klick wählt den Einsatz, dann ändern die Griffe an den Rändern die Länge (oder Umschalt + Pfeiltasten); Doppelklick oder Enter öffnet die Anfrage."}
              {" In der Wochenansicht öffnet ein Klick auf das Datum den ganzen Tag."}
            </p>
          </details>
        </div>

        <div className="plan3__scroll">
          <div className={`plan3__table${view === "tag" ? " plan3__table--day" : ""}`} style={{ gridTemplateColumns: `9.5rem repeat(${days.length}, minmax(${view === "tag" ? "0" : "5.4rem"}, 1fr))` }}>
            <div aria-hidden="true" />
            {days.map((day, index) => (
              <div key={day} className={`plan3__colh${index % 2 ? " is-alternate" : ""}${day === today ? " is-today" : ""}`} aria-current={day === today ? "date" : undefined}>
                <span className="plan3__colh-top">{day === today ? "Heute" : ""}</span>
                {view === "tag" ? <strong>{longDay(day)}</strong> : (
                  <button type="button" className="plan3__date" data-day={day} disabled={navigating}
                    aria-label={`${longDay(day)} in Tagesansicht öffnen`} title="Tagesansicht öffnen"
                    onClick={() => navigate({ view: "tag", day })}>
                    <strong>{shortDay(day)}</strong>
                  </button>
                )}
                <span className="plan3__ticks" aria-hidden="true">
                  {ticks.map((minute) => <span key={minute} style={{ left: `${pct(minute)}%` }}>{toTime(minute).slice(0, 2)}</span>)}
                </span>
              </div>
            ))}
            {technicians.map((tech) => {
              const load = loadLabel(tech.id);
              return (
                <div key={tech.id} className="plan3__row">
                  <div className="plan3__rowh">
                    <strong>{tech.name}</strong>
                    {load && (
                      <span className="plan3__load" title={load.title} data-month-load={load.percent ?? "abwesend"}>
                        <span className="plan3__loadbar" aria-hidden="true"><i style={{ width: `${Math.min(100, load.percent ?? 0)}%` }} /></span>
                        <span>{monthShort} · {load.percent === null ? "abwesend" : <><span className="mono">{load.percent}</span> % belegt</>}</span>
                        <span className="sr-only">, {load.title}</span>
                      </span>
                    )}
                  </div>
                  {days.map((day, index) => <div key={day} className={`plan3__cell${index % 2 ? " is-alternate" : ""}${day === today ? " is-today" : ""}`}>{lane(tech.id, day)}</div>)}
                </div>
              );
            })}
          </div>
        </div>
        {notice && <p className="plan3__notice" role="status">{notice}</p>}
        {move && (
          <form className="plan3__move" action={moveAction} aria-labelledby="verschieben-title">
            <input type="hidden" name="visit_id" value={move.visitId} />
            <input type="hidden" name="version" value={busy.find((block) => block.move?.visitId === move.visitId)?.move?.version ?? move.version} />
            <input type="hidden" name="technician_id" value={move.to.technicianId} />
            <input type="hidden" name="date" value={move.to.day} />
            <input type="hidden" name="start" value={move.to.start} />
            <input type="hidden" name="end" value={move.to.end} />
            <h3 id="verschieben-title" className="plan3__eyebrow">Einsatz {move.block.requestNumber} {onlyLength(move) ? "Dauer ändern" : "verschieben"}</h3>
            <p className="plan3__move-change">
              <span><span className="plan3__muted">Bisher</span> {techName(move.from.technicianId)} · {shortDay(move.from.day)} <span className="mono">{move.from.start}–{move.from.end}</span></span>
              <Icon name="arrow-right" size={16} />
              <span><span className="plan3__muted">Neu</span> <strong>{techName(move.to.technicianId)} · {shortDay(move.to.day)} <span className="mono">{move.to.start}–{move.to.end}</span></strong></span>
            </p>
            {moveCheck && !moveCheck.ok && <p className="plan3__check plan3__check--bad"><Icon name="alert" size={18} /><span>{moveCheck.message}</span></p>}
            <label className="plan3__move-reason">
              <span>Grund</span>
              <input name="reason" type="text" maxLength={500} defaultValue={onlyLength(move) ? RESIZE_REASON : DEFAULT_REASON} key={`${move.visitId}-${onlyLength(move)}`} />
            </label>
            {/* task-20-7: a new time goes to the customer; another technician alone does not concern them */}
            {(move.to.day !== move.from.day || move.to.start !== move.from.start || move.to.end !== move.from.end) && (
              <label className="plan3__move-notify">
                <input name="notify_customer" type="checkbox" defaultChecked />
                <span>Kunden über die Terminänderung informieren</span>
              </label>
            )}
            <div className="plan3__move-actions">
              <button type="submit" className="button button--primary" disabled={moving || !moveCheck?.ok}>{moving ? "Wird gespeichert …" : onlyLength(move) ? "Dauer speichern" : "Verschieben"}</button>
              <button type="button" className="button button--secondary" disabled={moving} onClick={() => { setMove(null); setNotice(""); }}>Abbrechen</button>
              {move.error && <p className="save-status save-status--error" role="alert">{move.error}</p>}
            </div>
          </form>
        )}
        {drag && (
          <div className={`plan3__drag-tip${dragCheck?.ok ? "" : " is-conflict"}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            <strong className="mono">{drag.snapped.start}–{drag.snapped.end}</strong>
            <span>{techName(drag.technicianId)} · {shortDay(drag.day)}{dragCheck && !dragCheck.ok ? ` · ${dragCheck.message}` : ""}</span>
          </div>
        )}
      </section>

      <aside id="auswahl" className="rw-card rw-card--action plan3__panel" aria-labelledby="auswahl-title">
        <h2 id="auswahl-title" className="plan3__eyebrow">{props.change ? "Verschiebewunsch" : "Einsatz planen"}</h2>
        {request ? (
          <>
            <div className="plan3__panel-sec plan3__panel-sec--head">{props.requestSummary}</div>
            {props.change ? renderChangePanel() : (
              <>
              {props.suggest && <div className="plan3__panel-sec">
                <h3 className="plan3__eyebrow">Vorschläge</h3>
                {suggestions.length === 0 ? (
                  <p className="plan3__muted">Kein freies Fenster für {durationText(duration)} in den nächsten 7 Arbeitstagen. Im Termin unten ein früheres Ende eintragen oder eine spätere Woche öffnen.</p>
                ) : (
                  <ul className="plan3__sugs">
                    {suggestions.map((suggestion, index) => {
                      const active = pick?.technicianId === suggestion.technicianId && pick.day === suggestion.day && pick.start === suggestion.startTime && pick.end === suggestion.endTime;
                      return (
                        <li key={suggestion.technicianId}>
                          <button type="button" className="plan3__sug" aria-pressed={active}
                            onClick={() => {
                              const next = { technicianId: suggestion.technicianId, day: suggestion.day, start: suggestion.startTime, end: suggestion.endTime };
                              if (view === "woche" && !days.includes(next.day)) { setPick(next); setFormKey((key) => key + 1); navigate({ anchor: next.day, pick: next }); }
                              else if (view === "tag" && next.day !== focusDay) { setPick(next); setFormKey((key) => key + 1); navigate({ day: next.day, pick: next }); }
                              else choose(next);
                            }}>
                            <span className="plan3__rank" aria-hidden="true">{index + 1}</span>
                            <strong>{suggestion.name}</strong>
                            <span className="mono">{shortDay(suggestion.day)} · {suggestion.startTime}–{suggestion.endTime}</span>
                            <span className="plan3__why">{suggestion.reasons.map((reason) => slotReasonText(reason, suggestion)).join(" · ")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>}
              <div className="plan3__panel-sec">
                <h3 className="plan3__eyebrow">Termin</h3>
                <SaveForm key={formKey} action={scheduleVisit} submitLabel="Einsatz planen" className="plan3__form">
                  <HiddenField name="request_id" value={request.id} />
                  <HiddenField name="version" value={request.version} />
                  <div className="plan3__fields" onChange={onFormChange}>
                    <SelectField name="technician_id" label="Techniker" required defaultValue={pick?.technicianId ?? ""} options={technicians.map((tech) => ({ value: tech.id, label: tech.name }))} />
                    <TextField name="date" label="Datum" type="date" required defaultValue={pick?.day ?? (isoWeekday(addDays(today, 1)) > 5 ? nextWorkday(today, 1) : addDays(today, 1))} />
                    <div className="plan3__times">
                      <TextField name="start" label="Beginn" type="time" required defaultValue={pick?.start ?? "08:00"} />
                      <TextField name="end" label="Ende" type="time" required defaultValue={pick?.end ?? toTime(8 * 60 + duration)} />
                    </div>
                  </div>
                  <CheckboxField name="notify_customer" label="Terminbestätigung an den Kunden senden" defaultChecked />
                  <p className={`plan3__check plan3__check--${pickCheck ? (pickCheck.ok ? "ok" : "bad") : "none"}`} aria-live="polite">
                    <Icon name={pickCheck ? (pickCheck.ok ? "check-circle" : "alert") : "calendar"} size={18} />
                    <span>{pickCheck ? pickCheck.message : `Noch kein Termin gewählt: ${props.suggest ? "Vorschlag oder freie Fläche" : "Vormerkung oder freie Fläche"} in der Plantafel anklicken.`}</span>
                  </p>
                </SaveForm>
              </div>
              </>
            )}
          </>
        ) : (
          <div className="plan3__panel-sec">{props.emptyPanel}</div>
        )}
      </aside>
    </>
  );
}
