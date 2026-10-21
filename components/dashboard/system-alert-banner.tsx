import Link from "next/link";
import { Icon } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { alertSourceLabel, systemBanner, type SystemAlert } from "@/lib/system-summary";

// Hint on every dashboard page for admin and manager while warnings are open (task-17-10, pattern of
// send-backlog-alert). Hidden on the area "System" itself, which shows the same in its summary (globals.css).
export function SystemAlertBanner({ alerts }: { alerts: SystemAlert[] }) {
  const banner = systemBanner(alerts);
  if (!banner) return null;
  return (
    <section className={`rw-banner ${banner.critical ? "rw-banner--danger" : "rw-banner--info"} system-alert-banner`} role="status" data-system-alerts={alerts.length}>
      <Icon name="alert" size={20} />
      <div className="system-alert-banner__text">
        <p><strong>{banner.title}</strong></p>
        <p>
          {banner.worst.title} <span className="cell-sub">({alertSourceLabel(banner.worst.source)}, seit <span className="mono">{formatDateTime(banner.worst.first_seen_at)}</span>)</span>
        </p>
      </div>
      <Link className="button button--secondary system-alert-banner__link" href="/dashboard/system#system-warnungen">Zum Bereich System</Link>
    </section>
  );
}
