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
// items as buttons with counters. Below 900 px container width it becomes one switch button instead (the same list opens below it), so nothing scrolls sideways.
export function SideMenu({ label, title, scope, groups }: { label: string; title: string; scope?: ReactNode[]; groups: SideMenuGroup[] }) {
  const items = groups.flatMap((group) => group.items);
  const active = items.find((item) => item.active);
  const waiting = items.filter((item) => item.actionable && item.count).reduce((sum, item) => sum + (item.count ?? 0), 0);
  return (
    <>
      <nav className="side-menu side-menu--wide" aria-label={label}>
        <div className="side-menu__head">
          <p className="side-menu__title">{title}</p>
          {scope?.map((line, index) => <p key={index} className="side-menu__scope">{line}</p>)}
        </div>
        <MenuGroups groups={groups} />
      </nav>
      <details className="side-menu side-menu--narrow">
        <summary className="side-menu__switch">
          <span className="side-menu__switch-text">
            <span className="side-menu__switch-label">{title} · Ansicht</span>
            <strong>{active?.label ?? label}{active?.count !== undefined && active.count !== null && <span className="side-menu__switch-count mono">{formatNumber(active.count)}</span>}</strong>
          </span>
          {waiting > 0 && <span className="side-menu__switch-todo"><span className="mono">{formatNumber(waiting)}</span> zu tun</span>}
          <span className="side-menu__switch-icon" aria-hidden="true"><Icon name="chevron-down" size={20} /></span>
        </summary>
        <nav aria-label={label}>
          <MenuGroups groups={groups} />
        </nav>
      </details>
    </>
  );
}

function MenuGroups({ groups }: { groups: SideMenuGroup[] }) {
  return (
    <>
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
    </>
  );
}
