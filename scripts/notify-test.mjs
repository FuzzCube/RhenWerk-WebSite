// Test e-mail to the recipients in ALERT_EMAILS (task-17-3): npm run notify:test
// In operation from the production copy: cd ~/RheinWerk-Prod/current && npm run notify:test
import { alertRecipients, sendAlert } from "./lib/notify.mjs";

const result = await sendAlert({
  subject: "Probe-E-Mail",
  text: "Diese Probe-E-Mail zeigt, dass Warnungen des RheinWerk-Betriebs (Updates, n8n, Mira) ankommen.\nEs ist nichts zu tun.",
});
if (result.ok) console.log(`Probe-E-Mail angenommen für ${result.accepted.join(", ")} (an ${alertRecipients().join(", ")})`);
process.exit(result.ok ? 0 : 1);
