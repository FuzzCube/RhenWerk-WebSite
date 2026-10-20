import Link from "next/link";
import { Icon } from "@/components/ui";
import { formatRange, neighbourAnchors, PERIOD_OPTIONS, periodQuery, periodTitle, type PeriodParams } from "@/lib/analytics";

// Compact period control of the redesign (task-10-3): sits at the block it filters. Selected period
// in lime (selection state), previous/next as 44px buttons; the range text belongs to the block note.
export function PeriodControl({ basePath, period, window, hash = "", extraQuery = "" }: {
  basePath: string;
  period: PeriodParams;
  window: { is_complete: boolean; startDay: string; endDay: string };
  hash?: string;
  /** Further parameters of the page kept on every link, e.g. "&status=alle" */
  extraQuery?: string;
}) {
  const { previous, next } = neighbourAnchors(window.startDay, window.endDay);
  return (
    <nav className="rw-period" aria-label="Zeitraum">
      {/* Left of the buttons (task-12-6): the controls are right-aligned, so they keep their place when it appears */}
      {period.anchor && <Link className="rw-link-btn rw-period__current" href={`${basePath}${periodQuery(period.param, null)}${extraQuery}${hash}`} scroll={false}>Aktueller Zeitraum</Link>}
      <Link className="rw-period__step" href={`${basePath}${periodQuery(period.param, previous)}${extraQuery}${hash}`} aria-label="Vorheriger Zeitraum" scroll={false}>
        <Icon name="arrow-left" size={18} />
      </Link>
      <ul className="rw-period__kinds">
        {PERIOD_OPTIONS.map((option) => (
          <li key={option.param}>
            <Link href={`${basePath}${periodQuery(option.param, period.anchor)}${extraQuery}${hash}`} aria-current={option.kind === period.kind ? "page" : undefined} scroll={false}>{option.label}</Link>
          </li>
        ))}
      </ul>
      {window.is_complete
        ? <Link className="rw-period__step" href={`${basePath}${periodQuery(period.param, next)}${extraQuery}${hash}`} aria-label="Nächster Zeitraum" scroll={false}><Icon name="arrow-right" size={18} /></Link>
        : <span className="rw-period__step rw-period__step--disabled" aria-label="Nächster Zeitraum (liegt in der Zukunft)" role="img"><Icon name="arrow-right" size={18} /></span>}
    </nav>
  );
}

/** "Oktober 2026 · 01.10.2026 – 08.10.2026, 13:24 (laufend) · Vergleich mit 01.09.2026 – 08.09.2026, 13:24" */
export function periodDescription(period: PeriodParams, window: { current_start: string; current_end: string; previous_start: string; previous_end: string; is_complete: boolean; startDay: string }) {
  return `${periodTitle(period.kind, window.startDay)} · ${formatRange(window.current_start, window.current_end)}${window.is_complete ? "" : " (laufend)"} · Vergleich mit ${formatRange(window.previous_start, window.previous_end)}`;
}
