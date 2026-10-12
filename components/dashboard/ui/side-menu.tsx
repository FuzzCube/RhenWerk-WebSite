import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import { formatNumber } from "@/lib/format";

export type SideMenuItem = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  // Omitted: no counter is shown
  count?: number | null;
  // A non-empty count here means work is waiting (highlighted counter)
  actionable?: boolean;
  hazard?: boolean;
};

export type SideMenuGroup = { title: string; items: SideMenuItem[] };

// Dark side menu of list pages (task-10-3, after user feedback 12.10.2026): views grouped by urgency,
// items as buttons with counters. Below 900 px container width it turns into a horizontal strip.
export function SideMenu({ label, title, scope, groups }: { label: string; title: string; scope?: ReactNode[]; groups: SideMenuGroup[] }) {
  return (
    <nav className="side-menu" aria-label={label}>
      <div className="side-menu__head">
        <p className="side-menu__title">{title}</p>
        {scope?.map((line, index) => <p key={index} className="side-menu__scope">{line}</p>)}
      </div>
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <div key={group.title} className="side-menu__group">
          <p className="side-menu__group-title">{group.title}</p>
          <ul>
            {group.items.map((item) => {
              const hasCount = item.count !== undefined;
              const empty = item.count === 0;
              const urgent = Boolean(item.actionable && item.count);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={`side-menu__item${item.hazard ? " side-menu__item--hazard" : ""}${urgent ? " is-urgent" : ""}${empty ? " is-empty" : ""}`}
                  >
                    {item.hazard && <Icon name="hazard" size={16} />}
                    <span className="side-menu__label">{item.label}</span>
                    {hasCount && <span className="side-menu__count mono">{item.count === null ? "–" : formatNumber(item.count!)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
