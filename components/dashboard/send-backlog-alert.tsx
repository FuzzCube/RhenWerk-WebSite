import { Icon } from "@/components/ui";
import type { EmployeeRole } from "@/lib/auth/roles";
import { sendBacklogText, type SendBacklog } from "@/lib/send-backlog";

// Hint on every dashboard page while e-mails wait for the Gmail dispatch (task-12-9). Usual cause: the Google access
// of the credential "RheinWerk Gmail" in n8n expired; the e-mails go out by themselves once it is reconnected.
export function SendBacklogAlert({ backlog, role }: { backlog: SendBacklog; role: EmployeeRole }) {
  const text = sendBacklogText(backlog, new Date());
  if (!text) return null;
  return (
    <section className="rw-banner rw-banner--danger send-backlog-alert" role="alert" data-send-backlog={backlog.waiting}>
      <Icon name="mail" size={20} />
      <div className="send-backlog-alert__text">
        <p><strong>E-Mail-Versand hängt</strong></p>
        <p>
          {text}{" "}
          {role === "dispatcher"
            ? "Bitte Verwaltung informieren. Die E-Mails gehen automatisch raus, sobald der Versand wieder läuft."
            : "Gmail-Zugang „RheinWerk Gmail“ in n8n prüfen und neu verbinden; die E-Mails gehen danach automatisch raus."}
        </p>
      </div>
    </section>
  );
}
