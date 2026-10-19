"use client";

import Link from "next/link";
import { Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MiraBudget, MiraStart } from "@/lib/mira-widget";

// Demo call (task-13-11, replaces the widget card of task-13-8). RheinWerk is a portfolio project without a phone
// line: every link to the service desk number (tel:+4962100000) opens a simulated call with the phone assistant
// Mira instead. Without JavaScript the link stays a normal phone link. The server reserves the minutes and hands out
// a signed URL (app/api/mira); the ElevenLabs client is loaded only when the caller confirms the notice.
const SERVICE_DESK = "tel:+4962100000";
const NUMBER = "+49 621 00000-0";
type Conversation = { endSession(): Promise<void>; setMicMuted(muted: boolean): void };
type Phase = "notice" | "ringing" | "live" | "ended" | "blocked" | "error";

const REASONS: Record<string, string> = {
  tageslimit: "Für heute sind die Gesprächsminuten der Demo aufgebraucht.",
  zu_viele: "Von diesem Anschluss wurden in der letzten Stunde schon mehrere Demo-Anrufe geführt.",
  mikrofon: "Ohne Zugriff auf das Mikrofon ist kein Anruf möglich. Bitte im Browser erlauben.",
  stoerung: "Die Verbindung zur KI-Assistentin ist gerade nicht möglich.",
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

async function fetchBudget(): Promise<MiraBudget> {
  try {
    const response = await fetch("/api/mira", { cache: "no-store" });
    return response.ok ? ((await response.json()) as MiraBudget) : { verfuegbar: false, restMinuten: 0 };
  } catch {
    return { verfuegbar: false, restMinuten: 0 };
  }
}

// German ring tone (425 Hz), two short rings while the connection is prepared
async function ring(times: number) {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  const tone = context.createOscillator();
  tone.frequency.value = 425;
  tone.connect(gain);
  tone.start();
  const start = context.currentTime + 0.05;
  for (let i = 0; i < times; i += 1) {
    gain.gain.setValueAtTime(0.12, start + i * 2);
    gain.gain.setValueAtTime(0, start + i * 2 + 1);
  }
  await new Promise((resolve) => window.setTimeout(resolve, times * 2000));
  tone.stop();
  await context.close();
}

export function DemoCall() {
  const dialog = useRef<HTMLDialogElement>(null);
  const conversation = useRef<Conversation | null>(null);
  const [phase, setPhase] = useState<Phase>("notice");
  const [budget, setBudget] = useState<MiraBudget | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [mode, setMode] = useState<"speaking" | "listening">("listening");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [limit, setLimit] = useState(180);

  const open = useCallback(() => {
    setPhase("notice");
    setReason(null);
    setBudget(null);
    dialog.current?.showModal();
    void fetchBudget().then(setBudget);
  }, []);

  // Every link to the service desk number opens the demo call (header, contact page, footer, forms)
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.(`a[href="${SERVICE_DESK}"]`);
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      open();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  // Call duration; the agent itself ends the call at the limit
  useEffect(() => {
    if (phase !== "live") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Leaving the page ends a running call
  useEffect(() => () => { void conversation.current?.endSession(); }, []);

  const fail = (key: string, next: Phase = "error") => {
    setReason(key);
    setPhase(next);
  };

  const call = async () => {
    setPhase("ringing");
    setSeconds(0);
    setMuted(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      fail("mikrofon");
      return;
    }
    // Session and ring tone in parallel
    const [session] = await Promise.all([
      fetch("/api/mira", { method: "POST" }).then((response) => response.json() as Promise<MiraStart>).catch((): MiraStart => ({ ok: false, grund: "stoerung" })),
      ring(2),
    ]);
    if (!session.ok) {
      fail(session.grund === "herkunft" ? "stoerung" : session.grund, session.grund === "tageslimit" || session.grund === "zu_viele" ? "blocked" : "error");
      return;
    }
    setLimit(session.maxSeconds);
    try {
      const { Conversation } = await import("@elevenlabs/client");
      conversation.current = await Conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: "websocket",
        onConnect: ({ conversationId }) => {
          setPhase("live");
          void fetch("/api/mira", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.sessionId, conversationId }) });
        },
        onDisconnect: () => {
          conversation.current = null;
          setPhase((current) => (current === "error" ? current : "ended"));
        },
        onError: () => fail("stoerung"),
        onModeChange: ({ mode: next }) => setMode(next),
      });
    } catch {
      fail("stoerung");
    }
  };

  const hangUp = async () => {
    if (conversation.current) await conversation.current.endSession();
    else setPhase("ended");
  };
  const close = async () => {
    await conversation.current?.endSession();
    dialog.current?.close();
  };
  const toggleMute = () => {
    conversation.current?.setMicMuted(!muted);
    setMuted(!muted);
  };

  const status = phase === "notice" ? "Demo-Anruf"
    : phase === "ringing" ? "Wählt …"
    : phase === "live" ? `${mode === "speaking" ? "Mira spricht" : "Mira hört zu"} · ${clock(seconds)}`
    : phase === "ended" ? `Anruf beendet${seconds ? ` · ${clock(seconds)}` : ""}`
    : "Anruf nicht möglich";

  return (
    <dialog ref={dialog} className="demo-call" aria-labelledby="demo-call-title" onCancel={(event) => { event.preventDefault(); void close(); }} data-call-phase={phase}>
      <button className="demo-call__close" type="button" aria-label="Schließen" onClick={() => void close()}><X size={20} /></button>
      <div className="demo-call__screen">
        <span className={`demo-call__avatar${phase === "live" ? ` demo-call__avatar--${mode}` : ""}${phase === "ringing" ? " demo-call__avatar--ringing" : ""}`} aria-hidden="true">M</span>
        <h2 id="demo-call-title">RheinWerk Service Desk</h2>
        <p className="demo-call__number mono">{NUMBER}</p>
        <p className="demo-call__status" role="status" aria-live="polite">{status}</p>
        {phase === "live" && <p className="demo-call__limit">höchstens {clock(limit)} Minuten</p>}
      </div>

      {phase === "notice" && (
        <div className="demo-call__body">
          <p className="demo-call__lead">RheinWerk ist ein Demo-Projekt. Statt des Service Desks meldet sich die KI-Assistentin Mira: Sie nimmt Serviceanfragen auf, nennt den Stand einer Anfrage und beantwortet Fragen. Eine Weiterleitung an einen Menschen gibt es in der Demo nicht.</p>
          <ul className="demo-call__notice">
            <li>Sie sprechen mit einer KI. Der Browser fragt nach dem Mikrofon.</li>
            <li>Die Sprache verarbeitet ElevenLabs; Audio wird nicht gespeichert, der Text 30 Tage. <Link href="/datenschutz">Datenschutz</Link></li>
            <li>Höchstens 3 Minuten je Anruf. {budget === null ? "Verfügbarkeit wird geprüft …" : budget.verfuegbar ? <>Heute noch <span className="mono">{budget.restMinuten}</span> Minuten.</> : "Für heute sind die Minuten aufgebraucht."}</li>
          </ul>
          <div className="demo-call__actions">
            <button className="demo-call__round demo-call__round--accept" type="button" disabled={!budget?.verfuegbar} onClick={() => void call()}>
              <Phone size={26} /><span>Einverstanden, anrufen</span>
            </button>
          </div>
        </div>
      )}

      {(phase === "ringing" || phase === "live") && (
        <div className="demo-call__actions">
          <button className="demo-call__round demo-call__round--muted" type="button" aria-pressed={muted} disabled={phase !== "live"} onClick={toggleMute}>
            {muted ? <MicOff size={24} /> : <Mic size={24} />}<span>{muted ? "Mikrofon an" : "Stumm"}</span>
          </button>
          <button className="demo-call__round demo-call__round--hangup" type="button" onClick={() => void hangUp()}>
            <PhoneOff size={26} /><span>Auflegen</span>
          </button>
        </div>
      )}

      {phase === "ended" && (
        <div className="demo-call__body">
          <p className="demo-call__lead">Hat Mira eine Anfrage angelegt, kommt die Eingangsbestätigung per E-Mail.</p>
          <div className="button-row">
            <Link className="button button--secondary" href="/serviceanfrage" onClick={() => dialog.current?.close()}>Anfrage schriftlich senden</Link>
            <button className="button button--secondary" type="button" onClick={() => dialog.current?.close()}>Schließen</button>
          </div>
        </div>
      )}

      {(phase === "blocked" || phase === "error") && (
        <div className="demo-call__body">
          <p className="demo-call__lead" role="alert">{REASONS[reason ?? "stoerung"]} Die Serviceanfrage ist der schriftliche Weg.</p>
          <div className="button-row">
            <Link className="button button--primary" href="/serviceanfrage" onClick={() => dialog.current?.close()}>Anfrage senden</Link>
            {phase === "error" && <button className="button button--secondary" type="button" onClick={() => setPhase("notice")}>Erneut versuchen</button>}
          </div>
        </div>
      )}
    </dialog>
  );
}
