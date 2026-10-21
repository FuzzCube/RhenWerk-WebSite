"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, useTransition, type ComponentProps, type MouseEvent } from "react";

// Smooth period switch (task-15-8): links inside the region navigate in a transition, so the current content stays
// until the new data is there instead of falling back to loading placeholders. While loading, PendingArea carries
// data-pending/aria-busy (CSS dims its content, not the controls) and the clicked link data-pending-link.
type PendingNav = { pending: boolean; target: string | null; navigate: (href: string) => void };

const PendingContext = createContext<PendingNav | null>(null);

export function PendingRegion({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const navigate = useCallback((href: string) => {
    setTarget(href);
    startTransition(() => router.push(href, { scroll: false }));
  }, [router]);
  return (
    <PendingContext.Provider value={{ pending, target: pending ? target : null, navigate }}>{children}</PendingContext.Provider>
  );
}

// The part of the page that depends on the period; keeps the layout of its own class
export function PendingArea({ className, children, ...rest }: ComponentProps<"div">) {
  const pending = useContext(PendingContext)?.pending ?? false;
  return <div {...rest} className={`pending-area ${className ?? ""}`} data-pending={pending ? "" : undefined} aria-busy={pending || undefined}>{children}</div>;
}

// Plain link outside a PendingRegion; modified clicks (new tab, download) keep the browser behaviour
export function PendingLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const context = useContext(PendingContext);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!context || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    context.navigate(href);
  };
  return <Link href={href} scroll={false} {...rest} onClick={handleClick} data-pending-link={context?.target === href ? "" : undefined} />;
}
