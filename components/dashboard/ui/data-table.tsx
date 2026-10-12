import Link from "next/link";
import type { ReactNode } from "react";

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "start" | "end";
  // Mobile card: "title" is the card heading, "hide" is only shown from tablet width on
  mobile?: "title" | "hide";
};

// One markup for all widths: a table from 768 px, stacked cards with labels below.
// Works in server and client components (no hooks).
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowClassName,
  empty,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string;
  // Optional class per row, e.g. to mark a hazard
  rowClassName?: (row: Row) => string | undefined;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="data-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "end" ? "data-table__end" : undefined}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((column, index) => {
                  const classes = [
                    column.align === "end" ? "data-table__end" : "",
                    column.mobile === "title" ? "data-table__title" : "",
                    column.mobile === "hide" ? "data-table__hide" : "",
                  ].filter(Boolean).join(" ");
                  const content = column.cell(row);
                  // One wrapper per cell keeps multi-part content in the value column of the mobile card
                  return (
                    <td key={column.key} data-label={column.header} className={classes || undefined}>
                      <div className="data-table__value">{href && index === 0 ? <Link href={href}>{content}</Link> : content}</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Simple list for short collections (e.g. today's visits); every item is one card
export function CardList<Item>({ items, itemKey, renderItem, empty, label }: { items: Item[]; itemKey: (item: Item) => string; renderItem: (item: Item) => ReactNode; empty: ReactNode; label: string }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className="card-list" aria-label={label}>
      {items.map((item) => <li key={itemKey(item)}>{renderItem(item)}</li>)}
    </ul>
  );
}
