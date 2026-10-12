import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  FileText,
  Info,
  LoaderCircle,
  Mail,
  MapPin,
  Pause,
  Phone,
  Play,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";

export type IconName =
  | "alert"
  | "arrow-left"
  | "arrow-right"
  | "calendar"
  | "check"
  | "check-circle"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "compressor"
  | "document"
  | "filter"
  | "hazard"
  | "info"
  | "inspection"
  | "location"
  | "mail"
  | "offline"
  | "pause"
  | "phone"
  | "play"
  | "pump"
  | "search"
  | "shield"
  | "spinner"
  | "upload"
  | "ventilation"
  | "wrench"
  | "x";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const props = { size, strokeWidth: 1.75, "aria-hidden": true as const };
  const standard = {
    alert: AlertCircle,
    "arrow-left": ArrowLeft,
    "arrow-right": ArrowRight,
    calendar: CalendarDays,
    check: Check,
    "check-circle": CircleCheck,
    "chevron-down": ChevronDown,
    "chevron-right": ChevronRight,
    clock: Clock3,
    document: FileText,
    filter: SlidersHorizontal,
    hazard: TriangleAlert,
    info: Info,
    inspection: FileText,
    location: MapPin,
    mail: Mail,
    offline: WifiOff,
    pause: Pause,
    phone: Phone,
    play: Play,
    search: Search,
    shield: ShieldCheck,
    spinner: LoaderCircle,
    upload: Upload,
    wrench: Wrench,
    x: X,
  } as const;
  if (name in standard) {
    const Component = standard[name as keyof typeof standard];
    return <Component {...props} />;
  }
  const paths: Record<"pump" | "compressor" | "ventilation", ReactNode> = {
    pump: (
      <>
        <circle cx="11" cy="14" r="5.5" /><circle cx="11" cy="14" r="1.5" />
        <path d="M11 8.5V4h7M2.5 14h3M6.5 20.5h9" />
      </>
    ),
    compressor: (
      <>
        <rect x="3" y="9" width="14" height="9" rx="1.5" />
        <path d="M17 13.5h4" /><circle cx="10" cy="5.5" r="2.5" />
        <path d="M10 8v1M6.5 18v3M13.5 18v3" />
      </>
    ),
    ventilation: (
      <>
        <path d="M10.83 16.38a6.08 6.08 0 0 1-8.62-7l5.41 1.45a6.08 6.08 0 0 1 7-8.62l-1.45 5.41a6.08 6.08 0 0 1 8.62 7l-5.41-1.45a6.08 6.08 0 0 1-7 8.62l1.45-5.41Z" />
        <circle cx="12" cy="12" r="1.5" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name as keyof typeof paths]}
    </svg>
  );
}

export function Logo({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <span className={`logo${inverse ? " logo--inverse" : ""}`}>
      <svg width="30" height="30" viewBox="0 0 32 32" role="img" aria-label="RheinWerk Industrieservice">
        <rect x="3" y="6" width="26" height="4" fill="currentColor" />
        <rect x="9" y="14" width="20" height="4" fill="var(--rw-color-lime-500)" />
        <rect x="3" y="22" width="26" height="4" fill="currentColor" />
      </svg>
      <span className="logo__type">
        <span className="logo__word">RheinWerk</span>
        {!compact && <span className="logo__descriptor">Industrieservice</span>}
      </span>
    </span>
  );
}

export function Container({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={narrow ? "container container--narrow" : "container"}>{children}</div>;
}

export function Section({ children, tone = "default", compact = false }: { children: ReactNode; tone?: "default" | "page" | "inverse"; compact?: boolean }) {
  return <section className={`section section--${tone}${compact ? " section--compact" : ""}`}>{children}</section>;
}

export function Eyebrow({ children, inverse = false }: { children: ReactNode; inverse?: boolean }) {
  return <p className={`eyebrow${inverse ? " eyebrow--inverse" : ""}`}>{children}</p>;
}

export function ButtonLink({ href, children, variant = "primary", icon }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; icon?: IconName }) {
  const body = <>{children}{icon && <Icon name={icon} size={18} />}</>;
  if (href.startsWith("tel:") || href.startsWith("mailto:")) return <a className={`button button--${variant}`} href={href}>{body}</a>;
  return <Link className={`button button--${variant}`} href={href}>{body}</Link>;
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="breadcrumb" aria-label="Brotkrümelnavigation">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHero({ eyebrow, title, body, chips = [] }: { eyebrow: string; title: string; body: string; chips?: string[] }) {
  return (
    <div className="page-hero">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1>{title}</h1>
      <p>{body}</p>
      {chips.length > 0 && <div className="chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>}
    </div>
  );
}

export function Alert({ tone = "info", lead, children }: { tone?: "info" | "warning" | "danger" | "success"; lead?: string; children: ReactNode }) {
  const icon = tone === "warning" || tone === "danger" ? "alert" : tone === "success" ? "check" : "info";
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon} size={20} />
      <p>{lead && <strong>{lead} </strong>}{children}</p>
    </div>
  );
}

export type Spec = { label: string; value: string; mono?: boolean };
export function Specs({ items }: { items: Spec[] }) {
  return (
    <dl className="specs">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "mono" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ children, accent = "steel", className = "" }: { children: ReactNode; accent?: "steel" | "navy" | "blue" | "lime"; className?: string }) {
  return <div className={`panel panel--${accent} ${className}`}>{children}</div>;
}

export function ServiceCard({ icon, title, body, href, lime = false }: { icon: IconName; title: string; body: string; href: string; lime?: boolean }) {
  return (
    <Link href={href} className={`service-card${lime ? " service-card--lime" : ""}`}>
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      <p>{body}</p>
      <span>Details ansehen <Icon name="arrow-right" size={16} /></span>
    </Link>
  );
}

export function PricingCard({ name, amount, unit, included, excluded }: { name: string; amount: string; unit: string; included: string[]; excluded: string[] }) {
  return (
    <div className="pricing-card">
      <Eyebrow>{name}</Eyebrow>
      <p className="pricing-card__amount">{amount}</p>
      <p className="pricing-card__unit">{unit}</p>
      <ul className="check-list">
        {included.map((item) => <li key={item}><Icon name="check" size={17} /><span>{item}</span></li>)}
        {excluded.map((item) => <li className="muted" key={item}><Icon name="x" size={17} /><span>{item}</span></li>)}
      </ul>
    </div>
  );
}

export function Process({ steps }: { steps: Array<{ title: string; body: string }> }) {
  return (
    <ol className="process">
      {steps.map((step, index) => <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}
    </ol>
  );
}

export function Checklist({ items, negative = false }: { items: string[]; negative?: boolean }) {
  return <ul className="check-list check-list--large">{items.map((item) => <li className={negative ? "muted" : undefined} key={item}><Icon name={negative ? "x" : "check"} size={18} /><span>{item}</span></li>)}</ul>;
}
