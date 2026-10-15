import Link from "next/link";
import type { ReactNode } from "react";
import type { KpiChange } from "@/lib/analytics";
import { Icon } from "@/components/ui";

// Metric with assessment (specification section 03): label · value (mono) · delta chip with word ·
// comparison value. The word in the chip ("besser", "schlechter", "mehr") makes the color redundant.
// The definition sits behind the info toggle, not in the tile.
type KpiTileProps = {
  label: string;
  value: string;
  change: KpiChange;
  previous: string;
  definition?: string;
  href?: string;
  hint?: string | null;
  // Machine-readable key and value (tests, links)
  kpiKey?: string;
  rawValue?: number | null;
};

export function DeltaChip({ change }: { change: KpiChange }) {
  return (
    <span className={`rw-delta rw-delta--${change.tone}`}>
      {change.text}
      {change.word && <> · {change.word}</>}
    </span>
  );
}

export function InfoToggle({ label, children }: { label: string; children: string }) {
  return (
    <details className="rw-info">
      <summary aria-label={`Definition: ${label}`} title="Definition anzeigen">
        <Icon name="info" size={18} />
      </summary>
      <p>{children}</p>
    </details>
  );
}

export function KpiTile({ label, value, change, previous, definition, href, hint, kpiKey, rawValue }: KpiTileProps) {
  return (
    <article className="rw-card rw-card--neutral rw-kpi" data-kpi={kpiKey} data-value={rawValue ?? ""}>
      <div className="rw-kpi__head">
        <h3 className="rw-kpi__label">{label}</h3>
        {definition && <InfoToggle label={label}>{definition}</InfoToggle>}
      </div>
      <p className="rw-kpi__value mono">{value}</p>
      <p className="rw-kpi__change">
        <DeltaChip change={change} />
        <span>Vorperiode <span className="mono">{previous}</span></span>
      </p>
      {change.note && <p className="rw-kpi__note">{change.note}</p>}
      {hint && <p className="rw-kpi__note">{hint}</p>}
      {href && <Link className="rw-link-btn rw-kpi__link" href={href}>Liste öffnen<Icon name="chevron-right" size={16} /></Link>}
    </article>
  );
}

// Compact row of further metrics behind "Weitere Kennzahlen anzeigen" (at most 4 tiles are visible).
// The tiles share the grid rows (subgrid), so values and chips line up across one- and two-line labels.
export function KpiMore({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className="rw-kpi-more">
      <summary>
        <span className="rw-kpi-more__show">Weitere Kennzahlen anzeigen ({count})</span>
        <span className="rw-kpi-more__hide">Weitere Kennzahlen ausblenden</span>
        <Icon name="chevron-down" size={18} />
      </summary>
      <div className="rw-kpi-more__grid">{children}</div>
    </details>
  );
}

export function KpiCompact({ label, value, change, previous, definition, href, kpiKey, rawValue }: KpiTileProps) {
  return (
    <div className="rw-kpi-compact" data-kpi={kpiKey} data-value={rawValue ?? ""}>
      <span className="rw-kpi-compact__label">
        {href ? <Link className="rw-kpi__link" href={href}>{label}</Link> : label}
        {definition && <InfoToggle label={label}>{definition}</InfoToggle>}
      </span>
      <span className="rw-kpi-compact__value mono">{value}</span>
      <span className="rw-kpi-compact__change"><DeltaChip change={change} /></span>
      <span className="rw-kpi-compact__previous">Vorperiode <span className="mono">{previous}</span></span>
    </div>
  );
}
