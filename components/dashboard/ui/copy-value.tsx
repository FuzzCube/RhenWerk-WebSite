"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

// A value with a copy button (task-15-1): the customer number is quoted on the phone, in e-mails and on paper,
// so it is copied often. The confirmation is announced to screen readers and disappears after two seconds.
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="copy-value">
      <span className="copy-value__text mono">{value}</span>
      <button type="button" className="copy-value__button" onClick={copy} aria-label={`${label} kopieren`}>
        <Icon name={state === "copied" ? "check" : "copy"} size={16} />
        <span aria-hidden="true">{state === "copied" ? "Kopiert" : "Kopieren"}</span>
      </button>
      <span className="sr-only" role="status">{state === "copied" ? `${label} kopiert` : state === "failed" ? "Kopieren nicht möglich" : ""}</span>
    </span>
  );
}
