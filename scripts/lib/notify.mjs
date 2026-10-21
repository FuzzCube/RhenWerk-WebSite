// Warning e-mails to the operator (task-17-3), sent directly via Gmail SMTP so that an outage of n8n (which sends all
// other e-mails) can itself be reported. Only used by scripts on the host, never by the web app.
//   SMTP_USER (sender, Gmail address), SMTP_APP_PASSWORD (Google app password, spaces allowed),
//   ALERT_EMAILS (recipients, comma-separated; user decision 21.10.2026: only the admin, not in the repository)
// sendAlert never throws: a failed send is logged and returned as { ok: false, error }, so the calling check or
// update goes on (the database retries the e-mail on the next check, task-17-2).
import nodemailer from "nodemailer";

export function alertRecipients() {
  return (process.env.ALERT_EMAILS ?? "").split(",").map((address) => address.trim()).filter(Boolean);
}

export async function sendAlert({ subject, text }) {
  const user = process.env.SMTP_USER ?? "";
  const pass = (process.env.SMTP_APP_PASSWORD ?? "").replace(/\s+/g, "");
  const to = alertRecipients();
  if (!user || !pass || to.length === 0) {
    const error = "SMTP_USER, SMTP_APP_PASSWORD oder ALERT_EMAILS fehlt";
    console.error(`Warn-E-Mail nicht gesendet: ${error}`);
    return { ok: false, error };
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  try {
    const info = await transport.sendMail({
      from: `"RheinWerk Betrieb" <${user}>`,
      to: to.join(", "),
      subject: `[RheinWerk] ${subject}`,
      text: `${text.trimEnd()}\n\n--\nAutomatische Nachricht vom RheinWerk-Betrieb (${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}).\n`,
    });
    return { ok: true, messageId: info.messageId, accepted: info.accepted };
  } catch (error) {
    console.error(`Warn-E-Mail nicht gesendet: ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    transport.close();
  }
}
