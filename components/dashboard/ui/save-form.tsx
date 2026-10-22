"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SearchSuggest } from "@/components/dashboard/ui/search-suggest";
import type { Suggestion } from "@/lib/dashboard/suggestions";
import { formatTime } from "@/lib/format";
import { initialFormState, type FormState } from "@/lib/forms";

type SaveAction = (previous: FormState, formData: FormData) => Promise<FormState>;
const SaveFormContext = createContext<{ state: FormState; pending: boolean }>({ state: initialFormState, pending: false });

// Result of the last save, for parts of a form that react to it (e.g. a confirmation step)
export function useSaveFormState() {
  return useContext(SaveFormContext);
}

// Form for dashboard save actions. Submits without React's automatic form reset, so inputs stay as typed
// after a failed save (validation, permission, version conflict). Shows saving, saved and error state.
export function SaveForm({
  action,
  children,
  submitLabel = "Speichern",
  submitVariant = "primary",
  resetOnSuccess = false,
  closeOnSuccess = false,
  className,
}: {
  action: SaveAction;
  children: ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger";
  resetOnSuccess?: boolean;
  // Closes the surrounding <details> after a successful save (edit form behind a read-only view)
  closeOnSuccess?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  // Time of the last input; changes count as unsaved until a later save result arrives
  const [lastInputAt, setLastInputAt] = useState<number | null>(null);
  const dirty = lastInputAt !== null && (state.submittedAt === null || lastInputAt > state.submittedAt);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status !== "success") return;
    if (resetOnSuccess) formRef.current?.reset();
    if (closeOnSuccess) formRef.current?.closest("details")?.removeAttribute("open");
  }, [state, resetOnSuccess, closeOnSuccess]);

  useEffect(() => {
    if (state.status !== "error") return;
    const firstInvalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    firstInvalid?.focus();
  }, [state]);

  return (
    <SaveFormContext.Provider value={{ state, pending }}>
      <form
        ref={formRef}
        method="post"
        className={`save-form${className ? ` ${className}` : ""}`}
        noValidate
        onInput={() => setLastInputAt(Date.now())}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => formAction(formData));
        }}
      >
        {children}
        <div className="save-form__footer">
          <button className={`button button--${submitVariant}`} type="submit" disabled={pending} aria-busy={pending}>{pending ? "Wird gespeichert …" : submitLabel}</button>
          <SaveStatus state={state} pending={pending} dirty={dirty} />
        </div>
      </form>
    </SaveFormContext.Provider>
  );
}

function SaveStatus({ state, pending, dirty }: { state: FormState; pending: boolean; dirty: boolean }) {
  let content: ReactNode = null;
  let tone = "neutral";
  if (pending) content = "Wird gespeichert …";
  else if (state.status === "error") { content = state.message; tone = "error"; }
  else if (dirty) content = "Ungespeicherte Änderungen";
  else if (state.status === "success") { content = `${state.message ?? "Gespeichert"} · ${formatTime(state.submittedAt)}`; tone = "success"; }
  return (
    <p className={`save-status save-status--${tone}`} role={tone === "error" ? "alert" : "status"} aria-live="polite">
      {content}
    </p>
  );
}

type FieldProps = { name: string; label: string; hint?: string; required?: boolean; defaultValue?: string };

function useField(name: string) {
  const { state, pending } = useContext(SaveFormContext);
  const error = state.fieldErrors[name];
  return { error, pending, describedBy: error ? `${name}-error` : undefined };
}

function FieldFrame({ name, label, hint, required, error, className, children }: FieldProps & { error?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`field${className ? ` ${className}` : ""}`} htmlFor={`field-${name}`}>
      <span>{label}<small>{required ? "Pflichtangabe" : "Optional"}</small></span>
      {children}
      {hint && <em>{hint}</em>}
      {error && <strong id={`${name}-error`}>{error}</strong>}
    </label>
  );
}

export function TextField({ type = "text", inputMode, autoComplete, ...props }: FieldProps & { type?: "text" | "email" | "tel" | "number" | "date" | "datetime-local" | "time" | "password"; inputMode?: "decimal" | "numeric" | "text"; autoComplete?: string }) {
  const { error, describedBy } = useField(props.name);
  return (
    <FieldFrame {...props} error={error}>
      <input id={`field-${props.name}`} name={props.name} type={type} inputMode={inputMode} autoComplete={autoComplete} defaultValue={props.defaultValue} required={props.required} aria-invalid={!!error} aria-describedby={describedBy} />
    </FieldFrame>
  );
}

// Text field with suggestions while typing (task-12-4); the chosen suggestion's value is written into the field
export function SuggestField({ area, className, placeholder, onPick, onType, ...props }: FieldProps & {
  area: "kundennummer" | "kundenstandort";
  className?: string;
  placeholder?: string;
  onPick?: (item: Suggestion) => void;
  onType?: (value: string) => void;
}) {
  const { error, describedBy } = useField(props.name);
  return (
    <FieldFrame {...props} className={className} error={error}>
      <SearchSuggest area={area} mode="fill" id={`field-${props.name}`} name={props.name} defaultValue={props.defaultValue} placeholder={placeholder} invalid={!!error} describedBy={describedBy} onPick={onPick} onType={onType} />
    </FieldFrame>
  );
}

export function TextAreaField(props: FieldProps & { rows?: number }) {
  const { error, describedBy } = useField(props.name);
  return (
    <FieldFrame {...props} error={error}>
      <textarea id={`field-${props.name}`} name={props.name} rows={props.rows ?? 4} defaultValue={props.defaultValue} required={props.required} aria-invalid={!!error} aria-describedby={describedBy} />
    </FieldFrame>
  );
}

// placeholder: a required select keeps a selectable empty first entry, so a preselection can be undone
export function SelectField({ options, emptyLabel = "Keine Auswahl", placeholder, ...props }: FieldProps & { options: Array<{ value: string; label: string }>; emptyLabel?: string; placeholder?: string }) {
  const { error, describedBy } = useField(props.name);
  return (
    <FieldFrame {...props} error={error}>
      <select id={`field-${props.name}`} name={props.name} defaultValue={props.defaultValue ?? ""} required={props.required} aria-invalid={!!error} aria-describedby={describedBy}>
        {!props.required && <option value="">{emptyLabel}</option>}
        {props.required && placeholder && <option value="">{placeholder}</option>}
        {props.required && !placeholder && !props.defaultValue && <option value="" disabled>Bitte wählen</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FieldFrame>
  );
}

// Context values (ids, versions). Controlled so a refreshed page passes the new version to the next save.
export function HiddenField({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={String(value)} readOnly />;
}

export function FileField({ name, label, accept, hint, required }: { name: string; label: string; accept: string; hint?: string; required?: boolean }) {
  const { error, describedBy } = useField(name);
  return (
    <FieldFrame name={name} label={label} hint={hint} required={required} error={error}>
      <input id={`field-${name}`} name={name} type="file" accept={accept} required={required} aria-invalid={!!error} aria-describedby={describedBy} />
    </FieldFrame>
  );
}

export function CheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="checkbox-field" htmlFor={`field-${name}`}>
      <input id={`field-${name}`} name={name} type="checkbox" value="on" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}
