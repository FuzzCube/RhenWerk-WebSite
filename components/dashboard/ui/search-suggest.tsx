"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Suggestion, SuggestArea } from "@/lib/dashboard/suggestions";

const MIN_LENGTH = 2;
const DELAY_MS = 200;

// Search field with suggestions while typing (task-12-4), ARIA combobox pattern: arrow keys move, Enter takes the
// highlighted suggestion, Esc closes. Enter without a highlighted suggestion submits the surrounding form as before,
// so the search also works without JavaScript. "navigate" opens the suggestion, "fill" writes its value into the field.
export function SearchSuggest({
  area,
  name,
  id,
  defaultValue = "",
  placeholder,
  className,
  message,
  mode = "navigate",
  label,
  invalid,
  describedBy,
  onPick,
  onType,
}: {
  area: SuggestArea;
  name: string;
  id: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  // Inbox e-mail the chosen request is offered for
  message?: string;
  mode?: "navigate" | "fill";
  // Accessible name when no visible label points to the field
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  // Called after a suggestion was taken over (fill mode), e.g. to fill further fields of the form
  onPick?: (item: Suggestion) => void;
  // Called on every typed change of the field
  onType?: (value: string) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const term = query.trim();
    // Shorter input: the list is hidden (see expanded); nothing to fetch
    if (term.length < MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ bereich: area, q: term });
      if (message) params.set("nachricht", message);
      try {
        const response = await fetch(`/dashboard/suche/vorschlaege?${params}`, { signal: controller.signal, headers: { accept: "application/json" } });
        if (!response.ok) return;
        const data = (await response.json()) as { items: Suggestion[] };
        setItems(data.items);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted by the next keystroke or offline: the plain search still works
      }
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, area, message]);

  const pick = (item: Suggestion) => {
    setOpen(false);
    setActive(-1);
    if (mode === "fill" || !item.href) {
      const input = inputRef.current;
      if (input) {
        input.value = item.value;
        // Lets forms that track unsaved input (SaveForm) notice the change
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      onPick?.(item);
      return;
    }
    router.push(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const shown = open && items.length > 0;
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp" && shown) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Enter" && shown && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === "Escape" && shown) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const expanded = open && query.trim().length >= MIN_LENGTH;
  return (
    <div className="search-suggest">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="search"
        className={className}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-expanded={expanded && items.length > 0}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          onType?.(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <ul id={listId} role="listbox" className="search-suggest__list" hidden={!expanded || items.length === 0} aria-label="Vorschläge">
        {items.map((item, index) => (
          <li
            key={item.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className="search-suggest__item"
            // mousedown keeps the focus in the field, so blur does not close the list before the click
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(item)}
            onMouseEnter={() => setActive(index)}
          >
            <span className="search-suggest__title">{item.title}</span>
            <span className="search-suggest__meta">{item.meta}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {expanded ? (items.length === 0 ? "Keine Vorschläge" : `${items.length} ${items.length === 1 ? "Vorschlag" : "Vorschläge"}, mit Pfeiltasten auswählen`) : ""}
      </p>
    </div>
  );
}
