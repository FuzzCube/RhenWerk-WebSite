"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatMinutes, formatNumber, formatPercent, formatCurrency } from "@/lib/format";

// Charts of the analysis page (task-7-3), Recharts 3 (evaluation in docs/decisions.md).
// Marks follow the dataviz rules: 2px lines, bars <= 24px with 4px rounded data end, 2px gap between
// bars, hairline grid, crosshair tooltip on lines, value first in the tooltip. Colors come from
// lib/chart-colors.ts (validated palette); text always uses text colors, never the series color.
// With two or more series the legend is a row of toggles (task-12-5): a click hides or shows a series, the y-axis
// and the tooltip follow the visible series, the last visible series stays. The data table keeps every series.
export type ChartSeries = { key: string; label: string; color: string };
export type ChartFormat = "count" | "percent" | "eur" | "hours";

const AXIS = { fontSize: 12, fill: "#526574" };
const GRID = "#D5DCE2";
const SURFACE = "#FCFBF7";

function formatValue(format: ChartFormat, value: unknown): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const number = Number(value);
  switch (format) {
    case "count": return formatNumber(number);
    case "percent": return formatPercent(number);
    case "eur": return formatCurrency(number);
    case "hours": return `${formatNumber(number, 1)} h`;
  }
}

function axisValue(format: ChartFormat, value: number): string {
  if (format === "eur") return value >= 1000 ? `${formatNumber(value / 1000, value % 1000 === 0 ? 0 : 1)} T€` : `${formatNumber(value)} €`;
  if (format === "percent") return `${formatNumber(value)} %`;
  return formatNumber(value);
}

type TooltipProps = TooltipContentProps<number, string> & { series: ChartSeries[]; format: ChartFormat; variant?: "savings" | "share" };

function ChartTooltip({ active, payload, label, series, format, variant }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown>;
  // Real values are kept under __all_<key> when the running period is split off as a dashed segment
  const value = (key: string) => (`__all_${key}` in row ? row[`__all_${key}`] : row[key]);
  return (
    <div className="chart-tooltip" role="status">
      <p className="chart-tooltip__label">{String(label)}</p>
      <ul>
        {series.map((entry) => (
          <li key={entry.key}>
            <span className="chart-tooltip__key" style={{ background: entry.color }} aria-hidden="true" />
            <strong>{formatValue(format, value(entry.key))}</strong>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
      {variant === "savings" && (
        <p className="chart-tooltip__note" data-savings-detail>
          {formatMinutes(Number(row.savedMinutes ?? 0))} = {formatNumber(Number(row.savedRequests ?? 0))} Anfragen × Basiswert {row.baseline === null || row.baseline === undefined ? "–" : formatMinutes(Number(row.baseline))}
        </p>
      )}
      {variant === "share" && (
        <p className="chart-tooltip__note">{formatNumber(Number(row.automatic))} von {formatNumber(Number(row.total))} automatisch</p>
      )}
    </div>
  );
}

export function TimeChart({
  kind,
  data,
  xKey,
  series,
  format,
  variant,
  height = 260,
  label,
  runningLast = false,
  legend = series.length >= 2,
}: {
  kind: "line" | "bar";
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: ChartSeries[];
  format: ChartFormat;
  variant?: "savings" | "share";
  height?: number;
  label: string;
  // The last point belongs to the running period: drawn as a dashed last segment (specification 05)
  runningLast?: boolean;
  // Legend with toggles above the chart; off for a single series
  legend?: boolean;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = series.filter((entry) => !hidden.includes(entry.key));
  const toggle = (key: string) => {
    if (hidden.includes(key)) setHidden(hidden.filter((item) => item !== key));
    else if (visible.length > 1) setHidden([...hidden, key]);
  };
  const split = kind === "line" && runningLast && data.length >= 2;
  const rows = split
    ? data.map((row, index) => {
        const next: Record<string, string | number | null> = { ...row };
        for (const entry of series) {
          next[`__all_${entry.key}`] = row[entry.key];
          next[`__run_${entry.key}`] = index >= data.length - 2 ? row[entry.key] : null;
          if (index === data.length - 1) next[entry.key] = null;
        }
        return next;
      })
    : data;
  const common = {
    data: rows,
    margin: { top: 8, right: 12, bottom: 4, left: 4 },
    accessibilityLayer: true,
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
      <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} interval="preserveStartEnd" />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} allowDecimals={format !== "count"} tickFormatter={(value: number) => axisValue(format, value)} />
      <Tooltip
        content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} series={visible} format={format} variant={variant} />}
        cursor={kind === "line" ? { stroke: "#7A8B99", strokeWidth: 1 } : { fill: "#E5EAEE", fillOpacity: 0.6 }}
        isAnimationActive={false}
      />
    </>
  );

  return (
    <>
      {legend && (
        <ul className="rw-legend rw-legend--toggle" aria-label="Legende: Reihen ein- und ausblenden">
          {series.map((entry) => {
            const shown = !hidden.includes(entry.key);
            const last = shown && visible.length === 1;
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-pressed={shown}
                  aria-disabled={last || undefined}
                  title={last ? "Mindestens eine Reihe bleibt sichtbar" : shown ? "Reihe ausblenden" : "Reihe einblenden"}
                  data-series={entry.key}
                  onClick={() => toggle(entry.key)}
                >
                  <span className="rw-legend__key" style={shown ? { background: entry.color } : { boxShadow: `inset 0 0 0 2px ${entry.color}` }} aria-hidden="true" />
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="chart" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height={height}>
          {kind === "line" ? (
            <LineChart {...common}>
              {axes}
              {series.map((entry) => (
                <Line key={entry.key} type="linear" dataKey={entry.key} name={entry.label} hide={hidden.includes(entry.key)} stroke={entry.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              ))}
              {split && series.map((entry) => (
                <Line key={`run-${entry.key}`} type="linear" dataKey={`__run_${entry.key}`} name={`${entry.label} (laufend)`} hide={hidden.includes(entry.key)} stroke={entry.color} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common} barGap={2} barCategoryGap="20%">
              {axes}
              {series.map((entry) => (
                <Bar key={entry.key} dataKey={entry.key} name={entry.label} hide={hidden.includes(entry.key)} fill={entry.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
