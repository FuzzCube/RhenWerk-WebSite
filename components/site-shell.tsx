"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Assistant } from "./assistant";
import { DemoCall } from "./demo-call";
import { ButtonLink, Icon, Logo } from "./ui";

const nav = [
  { label: "Startseite", href: "/" },
  { label: "Leistungen", href: "/leistungen" },
  { label: "Branchen", href: "/anlagen-und-branchen" },
  { label: "Über uns", href: "/ueber-uns" },
  { label: "Kontakt", href: "/kontakt" },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Zum Inhalt springen</a>
      <div className="utility-bar">
        <div className="utility-bar__inner">
          <span><Icon name="clock" size={15} /><span className="mono">Mo–Fr 07:00–18:00</span></span>
          <a href="tel:+4962100000"><Icon name="phone" size={15} /><span className="mono">+49 621 00000-0</span></a>
          <span className="utility-bar__note">24/7-Notfallkanal nur mit vereinbartem Notfall-SLA</span>
        </div>
      </div>
      <header className="site-header">
        <div className="site-header__inner">
          <Link href="/" aria-label="RheinWerk Industrieservice, Startseite"><Logo /></Link>
          <nav className="desktop-nav" aria-label="Hauptnavigation">
            {nav.map((item) => <Link key={item.href} className={pathname === item.href ? "active" : undefined} href={item.href}>{item.label}</Link>)}
          </nav>
          <div className="desktop-cta"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink></div>
          <button className="menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Menü schließen" : "Menü öffnen"}>{open ? <X /> : <Menu />}</button>
        </div>
        {open && <nav id="mobile-menu" className="mobile-nav" aria-label="Mobile Navigation">
          {nav.map((item) => <Link key={item.href} onClick={() => setOpen(false)} className={pathname === item.href ? "active" : undefined} href={item.href}>{item.label}</Link>)}
          <ButtonLink href="/serviceanfrage">Anfrage senden</ButtonLink>
          <a href="tel:+4962100000" className="mobile-nav__phone"><Icon name="phone" size={17} />+49 621 00000-0</a>
        </nav>}
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="site-footer__grid container">
          <div><Logo inverse compact /><p>RheinWerk Industrieservice GmbH<br />Rheinwerkstraße 12<br />68169 Mannheim</p><p className="mono">+49 621 00000-0<br />service@rheinwerk-<wbr />industrieservice.example</p></div>
          <div><h2>Leistungen</h2><Link href="/leistungen/inspektion">Inspektion</Link><Link href="/leistungen/wartung">Planmäßige Wartung</Link><Link href="/leistungen/fehlerdiagnose-reparatur">Diagnose und Reparatur</Link><Link href="/anlagen-und-branchen">Branchen</Link></div>
          <div><h2>Unternehmen</h2><Link href="/ueber-uns">Über uns</Link><Link href="/kontakt">Kontakt</Link><Link href="/serviceanfrage">Anfrage senden</Link><Link href="/cookie-richtlinie">Cookie-Richtlinie</Link></div>
          <div><h2>Servicezeiten</h2><p className="mono">Mo–Fr 07:00–18:00</p><p>Ohne gesetzliche Feiertage in Baden-Württemberg. 24/7-Notfallkanal nur mit vereinbartem Notfall-SLA.</p></div>
        </div>
        <div className="site-footer__legal"><div className="container"><Link href="/impressum">Impressum</Link><Link href="/datenschutz">Datenschutz</Link><Link href="/kundenbedingungen">Kundenbedingungen</Link><p>Fiktives Portfolio-Projekt. RheinWerk Industrieservice GmbH ist kein reales Unternehmen.</p></div></div>
      </footer>
      <div className="mobile-action"><ButtonLink href="/serviceanfrage">Anfrage senden</ButtonLink><a href="tel:+4962100000" aria-label="Service Desk anrufen"><Icon name="phone" /></a></div>
      <Assistant />
      <DemoCall />
    </div>
  );
}
