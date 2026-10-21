import Image from "next/image";
import Link from "next/link";
import { HeroVideo } from "./hero-video";
import { Alert, Breadcrumb, ButtonLink, Checklist, Container, Eyebrow, Icon, PageHero, Panel, PricingCard, Process, Section, ServiceCard, Specs, type IconName, type Spec } from "./ui";

const equipmentChips = ["Pumpen", "Kompressoren", "Lüftungsanlagen"];
const process = [
  { title: "Anfrage senden", body: "Per Formular oder E-Mail, mit Standort, Anlage und Fehlerbild." },
  { title: "Angaben und Dringlichkeit prüfen", body: "Der Service Desk prüft Vollständigkeit und Auswirkung. Kritische Fälle prüft ein Mensch." },
  { title: "Einsatz abstimmen", body: "Termin, Umfang und kommerzielle Bedingungen werden mit Ihnen bestätigt." },
];
const priceTravel = ["Anfahrt: 1,20 EUR netto je gefahrenem Kilometer, mind. 45 EUR netto"];
const pricing = {
  inspektion: { name: "Inspektion", amount: "290 EUR", unit: "netto je Maschine", included: ["Zustandsaufnahme und Messwerte", "Prüfbericht mit Befund"], excluded: priceTravel },
  wartung: { name: "Wartung", amount: "ab 690 EUR", unit: "netto je Maschine", included: ["Dokumentierter Prüfumfang und Wartungsprotokoll", "Definierte Verschleißteile nach Absprache"], excluded: priceTravel },
  reparatur: { name: "Fehlerdiagnose & Reparatur", amount: "145 EUR", unit: "netto je Technikerstunde · mind. 290 EUR netto", included: ["Diagnose vor Ort", "Reparatur nach Freigabe"], excluded: ["Ersatzteile nach Aufwand", ...priceTravel] },
};

const companySpecs: Spec[] = [
  { label: "Sitz", value: "Rheinwerkstraße 12, 68169 Mannheim", mono: true },
  { label: "Einsatzgebiet", value: "Metropolregion Rhein-Neckar" },
  { label: "Team", value: "55 Personen · 30 Servicetechniker", mono: true },
  { label: "Servicezeiten", value: "Mo–Fr 07:00–18:00", mono: true },
];
const contactSpecs: Spec[] = [
  { label: "Telefon", value: "+49 621 00000-0", mono: true },
  { label: "E-Mail", value: "service@rheinwerk-industrieservice.example", mono: true },
  { label: "Anschrift", value: "Rheinwerkstraße 12, 68169 Mannheim", mono: true },
  { label: "Servicezeiten", value: "Mo–Fr 07:00–18:00", mono: true },
];

export function HomePage() {
  return <>
    <div className="home-hero">
      <div className="home-hero__inner">
        <div className="home-hero__copy">
          <Eyebrow inverse>Industrieservice für die Metropolregion Rhein-Neckar</Eyebrow>
          <h1>Damit Ihre Anlagen zuverlässig laufen.</h1>
          <p>RheinWerk prüft, wartet und repariert Pumpen, Kompressoren und industrielle Lüftungsanlagen für Unternehmen in Industrie, Logistik und Lebensmittelproduktion.</p>
          <div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink><ButtonLink href="/leistungen" variant="secondary">Leistungen ansehen</ButtonLink></div>
        </div>
        <div className="home-hero__media">
          <HeroVideo />
        </div>
      </div>
    </div>
    <Section tone="page" compact><Container narrow><Alert lead="Kritische Fälle.">Bei Produktionsstillstand oder Sicherheitsgefahr melden Sie den Fall zusätzlich telefonisch unter <a href="tel:+4962100000">+49 621 00000-0</a>. Der 24/7-Notfallkanal steht nur Kunden mit vereinbartem Notfall-SLA zur Verfügung.</Alert></Container></Section>
    <Section><Container><Eyebrow>Unternehmen</Eyebrow><div className="split-grid"><div><h2>Ein Servicebetrieb in Mannheim, ein Einsatzradius</h2><p>Die RheinWerk Industrieservice GmbH hält Pumpen, Kompressoren und industrielle Lüftungsanlagen in Betrieb. 55 Personen arbeiten hier: 30 Servicetechniker im Einsatz, 8 Personen in Service Desk und Einsatzplanung.</p><p>Angefahren wird die Metropolregion Rhein-Neckar. Die Anfahrt rechnen wir je gefahrenem Kilometer ab Mannheim und zurück ab, damit die Rechnung nachvollziehbar bleibt.</p></div><Panel><h3>Eckdaten</h3><Specs items={companySpecs} /></Panel></div></Container></Section>
    <Section tone="page"><Container><div className="intro"><Eyebrow>Kernleistungen</Eyebrow><h2>Was Sie bei uns beauftragen</h2><p>Drei Leistungen mit definiertem Umfang. Jede endet mit einem Dokument, das Sie behalten.</p></div><div className="card-grid card-grid--3"><ServiceCard icon="inspection" title="Inspektion" body="Zustand aufnehmen, Messwerte dokumentieren, Prüfbericht erhalten." href="/leistungen/inspektion" /><ServiceCard icon="calendar" title="Planmäßige Wartung" body="Festes Intervall, dokumentierter Prüfumfang, Wartungsprotokoll je Maschine." href="/leistungen/wartung" /><ServiceCard lime icon="wrench" title="Diagnose und Reparatur" body="Fehler eingrenzen, Ursache benennen, Reparatur nach Ihrer Freigabe ausführen." href="/leistungen/fehlerdiagnose-reparatur" /></div></Container></Section>
    <Section><Container><div className="intro"><Eyebrow>Anlagen und Geräte</Eyebrow><h2>Drei Anlagentypen, kein vierter</h2><p>Wir nennen nur, was wir tatsächlich betreuen. Alles andere geben wir weiter.</p></div><div className="equipment-grid">
      <EquipmentCard image="/uploads/pumpen-industrieanlage.png" alt="Kreiselpumpe mit Flanschanschluss auf Grundplatte in einer Industrieanlage" title="Pumpen" body="Kreisel- und Verdrängerpumpen in Prozesskreisläufen." />
      <EquipmentCard image="/uploads/kompressoren-industrieanlage.png" alt="Schraubenkompressor mit Verrohrung und Schaltschrank in einer Werkshalle" title="Kompressoren" body="Schrauben- und Kolbenkompressoren in Druckluftnetzen." />
      <EquipmentCard image="/uploads/realistische-lueftungsanlage.png" alt="Industrielle Lüftungsanlage mit Kanalführung und Filterstufen in einer Halle" title="Lüftungsanlagen" body="Industrielle Zu- und Abluftanlagen in Hallen und Lagern." />
    </div></Container></Section>
    <Section tone="inverse"><Container><Eyebrow inverse>Zusammenarbeit</Eyebrow><div className="split-grid split-grid--inverse"><div><h2>Vier Gründe, die wir belegen können</h2><p>Wir sind kein Konzern. Was wir zusagen, ergibt sich aus dem Prüfumfang, der Mannschaft und dem Einsatzradius, nicht aus einer Erfahrungszahl.</p></div><div className="proof-grid"><Proof icon="document">Prüfbericht oder Wartungsprotokoll nach jedem Einsatz</Proof><Proof icon="location">Regionaler Einsatzradius, Anfahrt je gefahrenem Kilometer</Proof><Proof icon="inspection">Fester Prüfumfang statt pauschaler Zusagen</Proof><Proof icon="shield">Kritische Fälle prüft ein Mensch, nicht ein Algorithmus</Proof></div></div></Container></Section>
    <Section tone="page"><Container><Eyebrow>Ablauf</Eyebrow><div className="split-grid"><div><h2>Von der Anfrage zum Einsatz</h2><Process steps={process} /></div><Panel accent="lime"><h3>Anfrage senden</h3><p>Fünf Schritte. Eingaben bleiben erhalten, bis Sie senden. Mit dem Senden entsteht kein Auftrag.</p><div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink><ButtonLink href="tel:+4962100000" variant="secondary">+49 621 00000-0</ButtonLink></div><p className="fineprint">24/7-Notfallkanal nur mit vereinbartem Notfall-SLA.</p></Panel></div></Container></Section>
    <Section><Container><div className="intro"><Eyebrow>Kontakt</Eyebrow><h2>Service Desk und Servicezeiten</h2></div><div className="card-grid card-grid--2"><Panel accent="navy"><Specs items={contactSpecs} /></Panel><Alert lead="Servicezeiten.">Mo–Fr 07:00–18:00 · Ohne gesetzliche Feiertage in Baden-Württemberg. Anfragen außerhalb dieser Zeiten werden am nächsten Werktag geprüft. 24/7-Notfallkanal nur mit vereinbartem Notfall-SLA.</Alert></div></Container></Section>
  </>;
}

function EquipmentCard({ image, alt, title, body }: { image: string; alt: string; title: string; body: string }) {
  return <article className="equipment-card"><Image src={image} alt={alt} width={680} height={510} /><div><h3>{title}</h3><p>{body}</p><ul><li>Inspektion · Wartung · Reparatur</li><li>Prüfumfang nach Herstellerangabe</li></ul></div></article>;
}

function Proof({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <div className="proof"><Icon name={icon} size={24} /><p>{children}</p></div>;
}

export function ServicesPage() {
  return <>
    <Section tone="page" compact><Container><Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Leistungen" }]} /><PageHero eyebrow="Leistungen" title="Drei Leistungen mit definiertem Umfang" body="Inspektion, planmäßige Wartung, Diagnose und Reparatur für Pumpen, Kompressoren und industrielle Lüftungsanlagen." chips={equipmentChips} /></Container></Section>
    <Section><Container><div className="card-grid card-grid--3"><ServiceCard icon="inspection" title="Inspektion" body="Pumpen, Kompressoren und Lüftungsanlagen prüfen und den Zustand dokumentieren." href="/leistungen/inspektion" /><ServiceCard icon="calendar" title="Planmäßige Wartung" body="Einmalige Wartungsarbeiten oder Vertragswartung gemäß Vertrag und SLA." href="/leistungen/wartung" /><ServiceCard lime icon="wrench" title="Diagnose und Reparatur" body="Fehlersuche und Reparatur von Anlagen und Geräten, nach Freigabe." href="/leistungen/fehlerdiagnose-reparatur" /></div></Container></Section>
    <Section tone="page"><Container><div className="intro"><Eyebrow>Preisübersicht</Eyebrow><h2>Ausgangswerte je Leistung</h2><p>Die folgenden Zahlen sind Ausgangswerte. Verbindlich wird daraus ein Einzelauftrag oder ein vereinbartes SLA.</p></div><div className="card-grid card-grid--3"><PricingCard {...pricing.inspektion} /><PricingCard {...pricing.wartung} /><PricingCard {...pricing.reparatur} /></div><div className="card-grid card-grid--2"><Panel><h3>Anfahrt</h3><Specs items={[{ label: "Kilometersatz", value: "1,20 EUR netto je gefahrenem Kilometer", mono: true }, { label: "Berechnung", value: "ab Mannheim und zurück" }, { label: "Mindestbetrag", value: "45 EUR netto", mono: true }]} /></Panel><Alert lead="Preisrahmen.">Individuelle Aufträge und vereinbarte SLA haben Vorrang. Preise verstehen sich netto zuzüglich 19 % Umsatzsteuer.</Alert></div></Container></Section>
    <Section><Container><Eyebrow>Ablauf</Eyebrow><div className="split-grid"><div><h2>Wie ein Auftrag entsteht</h2><Process steps={process} /></div><Panel accent="lime"><h3>Leistung beauftragen</h3><p>Nennen Sie Standort, Anlage und Fehlerbild. Den Rest klärt der Service Desk mit Ihnen.</p><div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink></div></Panel></div></Container></Section>
  </>;
}

const servicePages = {
  inspektion: {
    crumb: "Inspektion",
    eyebrow: "Leistung · Inspektion",
    title: "Zustand aufnehmen, Befund dokumentieren",
    body: "Wir prüfen die Anlage nach festem Prüfumfang, erfassen Messwerte und übergeben einen Prüfbericht mit Befund.",
    sections: [
      { title: "Wann eine Inspektion sinnvoll ist", paragraphs: ["Vor der Übernahme einer Anlage, nach einer Störung oder als Grundlage für ein Wartungsintervall. Die Inspektion stellt fest, in welchem Zustand die Maschine ist, sie behebt nichts. Ergibt der Befund Handlungsbedarf, stimmen wir Wartung oder Reparatur getrennt mit Ihnen ab."] },
    ],
    scope: [
      { title: "Pumpen", specs: [{ label: "Prüfumfang", value: "Dichtheit, Lager, Laufrad, Betriebspunkt" }, { label: "Messwerte", value: "Druck, Volumenstrom, Temperatur, Vibration", mono: true }] },
      { title: "Kompressoren", specs: [{ label: "Prüfumfang", value: "Verdichter, Filter, Kondensatableitung, Steuerung" }, { label: "Messwerte", value: "Druck, Laufzeit, Temperatur", mono: true }] },
      { title: "Industrielle Lüftungsanlagen", specs: [{ label: "Prüfumfang", value: "Ventilator, Filterstufen, Kanalnetz, Regelung" }, { label: "Messwerte", value: "Volumenstrom, Druckdifferenz, Laufzeit", mono: true }] },
    ],
    included: ["Sicht- und Funktionsprüfung nach dokumentiertem Prüfumfang", "Aufnahme von Betriebsstunden, Messwerten und Verschleißbildern", "Prüfbericht mit Befund je Maschine, digital übergeben"],
    excluded: ["Instandsetzung oder Teiletausch, dafür beauftragen Sie Wartung oder Reparatur", ...priceTravel],
    price: pricing.inspektion,
    cta: "Inspektion anfragen",
    note: { lead: "Zielwert ist keine Garantie.", text: "Verbindliche Reaktions- und Einsatzzeiten entstehen ausschließlich über einen Einzelauftrag oder ein vereinbartes SLA." },
  },
  wartung: {
    crumb: "Planmäßige Wartung",
    eyebrow: "Leistung · Planmäßige Wartung",
    title: "Planmäßige Wartung nach festem Prüfumfang",
    body: "Feste Intervalle, dokumentierter Umfang, Wartungsprotokoll nach jedem Einsatz, einmalig oder als Vertragswartung.",
    sections: [{ title: "Zwei Formen der Wartung", paragraphs: [] }],
    scope: [
      { title: "Einmalige Wartungsarbeiten", text: "Ein Einsatz, ein Prüfumfang, ein Protokoll. Ohne Laufzeit, ohne Kündigungsfrist. Sinnvoll für einzelne Maschinen oder als Einstieg vor einem Vertrag.", specs: [{ label: "Umfang", value: "Ein Einsatz je Maschine" }, { label: "Ergebnis", value: "Wartungsprotokoll" }] },
      { title: "Vertragswartung gemäß Vertrag und SLA", text: "Feste Intervalle über einen Maschinenbestand, vereinbarte Konditionen und, falls vereinbart, ein Notfall-SLA. Vertragliche Regelungen haben Vorrang vor dieser Seite.", specs: [{ label: "Intervall", value: "Nach Herstellerangabe oder Betriebsstunden" }, { label: "Grundlage", value: "Vertrag und, falls vereinbart, SLA" }], lime: true },
    ],
    included: ["Sicht- und Funktionsprüfung nach dokumentiertem Prüfumfang", "Tausch definierter Verschleißteile nach Absprache", "Aufnahme von Betriebsstunden, Messwerten und Verschleißbildern", "Wartungsprotokoll je Maschine, digital übergeben"],
    excluded: ["Ersatzteile außerhalb der definierten Verschleißteile", "Reparaturen, die aus dem Befund folgen, diese stimmen wir vorher ab", ...priceTravel],
    price: pricing.wartung,
    cta: "Wartung anfragen",
    note: { lead: "Vertrag hat Vorrang.", text: "Individuelle Aufträge und vereinbarte SLA haben Vorrang. Preise verstehen sich netto zuzüglich 19 % Umsatzsteuer." },
  },
  reparatur: {
    crumb: "Diagnose und Reparatur",
    eyebrow: "Leistung · Diagnose und Reparatur",
    title: "Fehler eingrenzen, Ursache benennen, reparieren",
    body: "Fehlersuche vor Ort und Reparatur von Anlagen und Geräten. Die Reparatur beginnt erst nach Ihrer Freigabe.",
    urgent: true,
    sections: [
      { title: "Fehlersuche", paragraphs: ["Wir grenzen das Fehlerbild ein, Geräusch, Leckage, Druckabfall, Temperatur oder Meldung der Steuerung, und benennen die Ursache. Was wir nicht messen können, behaupten wir nicht: bleibt die Ursache offen, sagen wir das und schlagen den nächsten Schritt vor."], specs: [{ label: "Vorgehen", value: "Fehlerbild eingrenzen, Messwerte aufnehmen, Ursache benennen" }, { label: "Ergebnis", value: "Befund mit Empfehlung, schriftlich" }, { label: "Abrechnung", value: "145 EUR netto je Technikerstunde, mind. 290 EUR netto", mono: true }] },
      { title: "Reparatur von Anlagen und Geräten", paragraphs: ["Nach der Diagnose erhalten Sie Umfang, Teile und Aufwand. Erst mit Ihrer Freigabe wird repariert. Wo es möglich ist, geschieht beides in einem Einsatz; wo Teile fehlen, nennen wir den Zwischenstand statt eines Termins."] },
      { title: "Kritische Fälle", paragraphs: ["Produktionsstillstand oder eine bekannte Sicherheitsgefahr gehen nie automatisch durch die Aufnahme. Ein Mensch prüft den Fall, und wir nennen dafür eine Telefonnummer statt einer Ankunftszeit."] },
    ],
    scope: [],
    included: ["Diagnose vor Ort mit Messwerten und Befund", "Reparatur nach Freigabe, dokumentiert je Maschine"],
    excluded: ["Ersatzteile nach Aufwand", ...priceTravel],
    price: pricing.reparatur,
    cta: "Störung melden",
    note: { lead: "24/7 nur mit SLA.", text: "24/7-Notfallkanal nur mit vereinbartem Notfall-SLA. Ohne SLA gelten die Servicezeiten Mo–Fr 07:00–18:00." },
  },
};

export function ServiceDetailPage({ type }: { type: keyof typeof servicePages }) {
  const page = servicePages[type];
  return <Section tone="page" compact><Container>
    <Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Leistungen", href: "/leistungen" }, { label: page.crumb }]} />
    <PageHero eyebrow={page.eyebrow} title={page.title} body={page.body} chips={equipmentChips} />
    {"urgent" in page && page.urgent && <div className="urgent-strip"><Alert tone="danger" lead="Produktionsstillstand oder Sicherheitsgefahr?">Bitte melden Sie den Fall zusätzlich telefonisch unter <a href="tel:+4962100000">+49 621 00000-0</a>.</Alert></div>}
    <div className="detail-layout">
      <div className="detail-main">
        {page.sections.map((section) => <div className="content-block" key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{"specs" in section && section.specs && <Panel><Specs items={section.specs} /></Panel>}</div>)}
        {page.scope.length > 0 && <div className="content-block"><h2>{type === "wartung" ? "Wartungsformen" : "Prüfumfang je Anlagentyp"}</h2><div className="scope-grid">{page.scope.map((item) => <Panel key={item.title} accent={"lime" in item && item.lime ? "lime" : "navy"}><h3>{item.title}</h3>{"text" in item && item.text && <p>{item.text}</p>}<Specs items={item.specs} /></Panel>)}</div></div>}
        <div className="content-block"><h2>Enthaltene Arbeiten</h2><Checklist items={page.included} /></div>
        <div className="content-block"><h2>Nicht enthalten</h2><Checklist negative items={page.excluded} /></div>
      </div>
      <aside className="detail-aside"><PricingCard {...page.price} /><ButtonLink href="/serviceanfrage" icon="arrow-right">{page.cta}</ButtonLink>{type === "reparatur" && <ButtonLink href="tel:+4962100000" variant="secondary">+49 621 00000-0</ButtonLink>}<Alert tone={type === "reparatur" ? "warning" : "info"} lead={page.note.lead}>{page.note.text}</Alert></aside>
    </div>
  </Container></Section>;
}

export function IndustriesPage() {
  const industries = [
    { name: "Industrieunternehmen", body: "Fertigungsbetriebe mit kontinuierlichen Prozessen und knappen Stillstandsfenstern.", equipment: "Pumpen, Kompressoren", request: "Fehlerdiagnose bei Druckabfall" },
    { name: "Logistikunternehmen", body: "Umschlag- und Lagerstandorte mit Druckluftnetzen und Hallenlüftung.", equipment: "Kompressoren, Lüftungsanlagen", request: "Wartung außerhalb der Schicht" },
    { name: "Lebensmittelproduzierende Unternehmen", body: "Hygienisch sensible Umgebungen mit engen Reinigungs- und Stillstandsfenstern.", equipment: "Pumpen, Lüftungsanlagen", request: "Wartung im Produktionsfenster" },
  ];
  return <>
    <Section tone="page" compact><Container><Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Branchen" }]} /><PageHero eyebrow="Branchen" title="Drei Branchen, ein Prüfumfang" body="Die Branche bestimmt vor allem das Zeitfenster, in dem wir arbeiten, nicht den Umfang der Prüfung." chips={["Industrie", "Logistik", "Lebensmittelproduktion"]} /></Container></Section>
    <Section><Container><div className="card-grid card-grid--3">{industries.map((item) => <Panel accent="blue" key={item.name}><Eyebrow>Branche</Eyebrow><h3>{item.name}</h3><p>{item.body}</p><Specs items={[{ label: "Typische Anlagen", value: item.equipment }, { label: "Häufige Anfrage", value: item.request }]} /></Panel>)}</div></Container></Section>
    <Section tone="page"><Container><div className="intro"><Eyebrow>Zeitfenster</Eyebrow><h2>Wann wir arbeiten können</h2></div><div className="card-grid card-grid--2"><Specs items={[{ label: "Industrie", value: "Stillstandsfenster in der Fertigung, oft kurzfristig" }, { label: "Logistik", value: "Außerhalb der Schicht, häufig früh oder spät" }, { label: "Lebensmittelproduktion", value: "Im Reinigungs- oder Produktionsfenster" }, { label: "Grenze", value: "Einsätze Mo–Fr 07:00–18:00, außer bei vereinbartem SLA" }]} /><Alert tone="warning" lead="Kein Anlagentyp außerhalb der Liste.">Anfragen zu anderen Anlagen beantwortet der Service Desk mit einer Absage oder einer Empfehlung, nicht mit einem Versuch.</Alert></div><div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink></div></Container></Section>
  </>;
}

export function AboutPage() {
  const principles = [
    { title: "Vollständigkeit vor Geschwindigkeit", body: "Fehlen Standort, Anlagentyp oder Maschinennummer, fragen wir nach, statt zu raten." },
    { title: "Einstufung, keine Zusage", body: "P1 bis P4 beschreiben die Aufnahme. Zielwert ist keine Garantie; verbindliche Zeiten entstehen vertraglich." },
    { title: "Kritische Fälle prüft ein Mensch", body: "Produktionsstillstand oder eine bekannte Sicherheitsgefahr gehen nie automatisch durch." },
    { title: "Absage statt Versuch", body: "Anfragen außerhalb unserer drei Anlagentypen beantworten wir mit einer Empfehlung." },
  ];
  return <>
    <Section tone="page" compact><Container><Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Über uns" }]} /><PageHero eyebrow="Über uns" title="RheinWerk Industrieservice GmbH" body="55 Personen in Mannheim. Groß genug für planbare Wartung, klein genug, dass die Einsatzplanung Ihren Standort kennt." /></Container></Section>
    <Section><Container><div className="split-grid"><div><h2>Wie wir arbeiten</h2><p>RheinWerk prüft, wartet und repariert Pumpen, Kompressoren und industrielle Lüftungsanlagen. Der Einsatzradius ist die Metropolregion Rhein-Neckar; die Anfahrt wird je gefahrenem Kilometer abgerechnet, damit die Rechnung nachvollziehbar bleibt.</p><p>Anfragen laufen digital ein und werden von einem Menschen geprüft. Kritische Fälle, Produktionsstillstand oder eine bekannte Sicherheitsgefahr, gehen nie automatisch durch. Wir nennen dafür keine Ankunftszeit, sondern eine Telefonnummer.</p><p>Was außerhalb unserer drei Anlagentypen liegt, übernehmen wir nicht. Diese Grenze ist die Voraussetzung dafür, dass der Prüfumfang je Maschine belastbar bleibt.</p></div><div className="proof-grid"><Stat value="30" label="Servicetechniker" /><Stat value="8" label="Personen in Service Desk und Einsatzplanung" /><Proof icon="location">Regional in der Rhein-Neckar-Region</Proof><Proof icon="shield">Digitale Erfassung, menschliche Freigabe bei kritischen Fällen</Proof></div></div></Container></Section>
    <Section tone="page"><Container><div className="intro"><Eyebrow>Team</Eyebrow><h2>Team und Fachkompetenzen</h2></div><div className="card-grid card-grid--2"><Panel><h3>Aufstellung</h3><Specs items={[{ label: "Servicetechniker", value: "30", mono: true }, { label: "Service Desk und Einsatzplanung", value: "8", mono: true }, { label: "Gesamt", value: "55 Personen", mono: true }, { label: "Geschäftsführung", value: "Dr. Lena Hartmann" }]} /></Panel><Panel><h3>Fachkompetenzen</h3><Checklist items={["Kreisel- und Verdrängerpumpen: Lager, Dichtungen, Betriebspunkt", "Schrauben- und Kolbenkompressoren: Verdichter, Filter, Kondensat", "Industrielle Lüftungsanlagen: Ventilator, Filterstufen, Regelung", "Messtechnik und Dokumentation: Prüfberichte, Wartungsprotokolle"]} /></Panel></div></Container></Section>
    <Section tone="inverse"><Container><div className="split-grid split-grid--inverse"><div><Eyebrow inverse>Einsatzgebiet</Eyebrow><h2>Rhein-Neckar-Region</h2><p>Wir fahren von Mannheim aus. Standorte außerhalb der Region nehmen wir nur an, wenn die Anfahrt vertraglich geregelt ist, sonst empfehlen wir einen Betrieb vor Ort.</p></div><div><Eyebrow inverse>Regelmäßig angefahren</Eyebrow><ul className="city-grid">{["Mannheim", "Ludwigshafen", "Heidelberg", "Speyer", "Worms", "Weinheim", "Schwetzingen", "Hockenheim"].map((city) => <li key={city}>{city}</li>)}</ul><p className="fineprint">Anfahrt 1,20 EUR netto je gefahrenem Kilometer ab Mannheim und zurück, mind. 45 EUR netto.</p></div></div></Container></Section>
    <Section><Container><div className="intro"><Eyebrow>Grundsätze</Eyebrow><h2>Wie wir Serviceanfragen bearbeiten</h2><p>Vier Regeln, die für jede Anfrage gelten, unabhängig von Kunde, Anlage und Uhrzeit.</p></div><div className="split-grid"><Process steps={principles} /><div className="stack"><ContactPerson /><Alert lead="Einstufung, keine Zusage.">P1 bis P4 beschreiben, wie eine Anfrage bei der Aufnahme eingestuft wird. Zielwert ist keine Garantie; verbindliche Zeiten entstehen ausschließlich vertraglich.</Alert></div></div></Container></Section>
  </>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="proof"><strong className="mono">{value}</strong><p>{label}</p></div>;
}

function ContactPerson() {
  return <Panel accent="blue" className="contact-person"><Image src="/uploads/dr-lena-hartmann-portrait-clean.png" alt="Dr. Lena Hartmann, Geschäftsführung" width={176} height={220} /><div><h3>Dr. Lena Hartmann</h3><p>Geschäftsführung</p><a href="tel:+4962100000"><Icon name="phone" size={15} />+49 621 00000-0</a><a href="mailto:service@rheinwerk-industrieservice.example"><Icon name="mail" size={15} />service@rheinwerk-industrieservice.example</a></div></Panel>;
}

export function ContactPage() {
  return <>
    <Section tone="page" compact><Container><Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: "Kontakt" }]} /><PageHero eyebrow="Kontakt" title="Kontakt" body="Service Desk, Anschrift und Servicezeiten. Für einen konkreten Auftrag ist die Serviceanfrage der schnellere Weg." /><div className="card-grid card-grid--2"><Panel accent="navy"><h2>Service Desk</h2><Specs items={[...contactSpecs, { label: "Feiertage", value: "Ohne gesetzliche Feiertage in Baden-Württemberg" }, { label: "24/7", value: "Nur mit vereinbartem Notfall-SLA" }]} /><div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink><ButtonLink href="tel:+4962100000" variant="secondary">+49 621 00000-0</ButtonLink></div><p className="demo-call-hint">Demo: Ein Klick auf die Nummer startet einen Anruf bei der KI-Assistentin Mira.</p></Panel><div className="stack"><ContactPerson /><Alert lead="Öffnungszeiten.">Montag bis Freitag, 07:00–18:00 Uhr. Ohne gesetzliche Feiertage in Baden-Württemberg. 24/7-Notfallkanal nur mit vereinbartem Notfall-SLA.</Alert></div></div></Container></Section>
    <Section><Container><div className="intro"><Eyebrow>Anfahrt</Eyebrow><h2>Rheinwerkstraße 12, 68169 Mannheim</h2></div><div className="card-grid card-grid--2 contact-map"><div className="map-frame"><iframe src="/karte.html" title="Karte: Standort Rheinwerkstraße 12, 68169 Mannheim" loading="lazy" /><p>Kartendaten © OpenStreetMap-Mitwirkende · Kartenausschnitt zeigt den Postleitzahlbereich 68169 Mannheim</p></div><div className="stack"><Panel><h3>Anfahrtsbeschreibung</h3><Specs items={[{ label: "Auto", value: "A6 oder A656 bis Mannheim, weiter über die B44 in die Neckarstadt" }, { label: "Parken", value: "Besucherparkplätze auf dem Betriebsgelände" }, { label: "Anlieferung", value: "Nach Absprache mit dem Service Desk" }, { label: "ÖPNV", value: "Haltestelle in Gehweite; die Linie nennt der Service Desk" }]} /></Panel><Alert lead="Fiktive Adresse.">RheinWerk Industrieservice GmbH ist ein fiktives Portfolio-Projekt. Der Kartenausschnitt zeigt den Postleitzahlbereich, nicht ein reales Betriebsgelände.</Alert></div></div></Container></Section>
  </>;
}

type LegalKind = "impressum" | "datenschutz" | "cookies" | "kundenbedingungen";
export function LegalPage({ kind }: { kind: LegalKind }) {
  const header = {
    impressum: ["Impressum", "Angaben gemäß § 5 DDG. Dieses Impressum gehört zu einem fiktiven Portfolio-Projekt."],
    datenschutz: ["Datenschutz", "Welche Daten die Serviceanfrage erhebt, wozu wir sie verarbeiten und wie lange wir sie aufbewahren."],
    cookies: ["Cookie-Richtlinie", "Diese Website setzt keine Analyse- und keine Marketing-Cookies. Was gespeichert wird, steht hier vollständig."],
    kundenbedingungen: ["Kundenbedingungen", "Dieses Dokument gehört nicht zum Umfang des Prototyps."],
  }[kind];
  return <Section tone="page" compact><Container><Breadcrumb items={[{ label: "Startseite", href: "/" }, { label: header[0] }]} /><PageHero eyebrow="Rechtliches" title={header[0]} body={header[1]} />
    {kind === "impressum" && <div className="card-grid card-grid--2 legal-content"><Panel><h2>Anbieter</h2><Specs items={[{ label: "Unternehmen", value: "RheinWerk Industrieservice GmbH" }, { label: "Anschrift", value: "Rheinwerkstraße 12, 68169 Mannheim", mono: true }, { label: "Geschäftsführung", value: "Dr. Lena Hartmann" }, { label: "Telefon", value: "+49 621 00000-0", mono: true }, { label: "E-Mail", value: "service@rheinwerk-industrieservice.example", mono: true }, { label: "Registereintrag", value: "Nicht vergeben, fiktives Portfolio-Projekt" }, { label: "USt-IdNr.", value: "Nicht vergeben, fiktives Portfolio-Projekt" }]} /></Panel><div><h2>Haftung und Inhalte</h2><p>Die Inhalte dieser Website beschreiben Leistungen, Preisrahmen und Servicezeiten eines fiktiven Unternehmens. Sie stellen kein Angebot dar und begründen keine Ansprüche.</p><p>Registereintrag, Umsatzsteuer-Identifikationsnummer und Aufsichtsbehörde sind nicht vergeben, da kein reales Unternehmen dahintersteht. In einer echten Veröffentlichung stehen an dieser Stelle Handelsregister, Registernummer und USt-IdNr.</p><h2>Verantwortlich für den Inhalt</h2><p>Dr. Lena Hartmann, Geschäftsführung, Anschrift wie oben.</p></div></div>}
    {kind === "datenschutz" && <div className="legal-stack"><Alert lead="Platzhaltertext.">Dieser Text gehört zu einem fiktiven Portfolio-Projekt, ersetzt keine Rechtsberatung und ist keine vollständige Datenschutzerklärung.</Alert><LegalCopy /></div>}
    {kind === "cookies" && <div className="card-grid card-grid--2 legal-content"><Panel><h2>Was gespeichert wird</h2><Specs items={[{ label: "Formulareingaben", value: "Sitzung im Browser, bis zum Senden", mono: true }, { label: "Analyse-Cookies", value: "Keine" }, { label: "Marketing-Cookies", value: "Keine" }, { label: "Kartenkacheln", value: "OpenStreetMap, nur auf der Kontaktseite" }]} /></Panel><div><h2>Technisch notwendige Speicherung</h2><p>Damit die Serviceanfrage über fünf Schritte funktioniert, hält die Website Ihre Eingaben in der laufenden Sitzung im Browser. Diese Daten verlassen den Browser erst, wenn Sie senden, und werden beim Schließen verworfen.</p><h2>Externe Inhalte</h2><p>Der Kartenausschnitt auf der Kontaktseite lädt Kacheln von OpenStreetMap. Dabei wird Ihre IP-Adresse an den Kachelserver übertragen. Ohne Aufruf der Kontaktseite findet diese Übertragung nicht statt. Ein Demo-Anruf bei der KI-Assistentin „Mira“ (Klick auf die Service-Desk-Nummer) verbindet den Browser erst nach Ihrer Bestätigung mit ElevenLabs; dafür werden keine Cookies gesetzt.</p><h2>Keine Einwilligungspflicht</h2><p>Da keine Analyse-, Tracking- oder Marketing-Cookies gesetzt werden, gibt es kein Cookie-Banner. Mehr zur Verarbeitung Ihrer Daten steht im <Link href="/datenschutz">Datenschutz</Link>.</p></div></div>}
    {kind === "kundenbedingungen" && <div className="legal-stack"><Alert lead="Nicht angelegt.">Für dieses fiktive Portfolio-Projekt wurden keine Kundenbedingungen formuliert. Angelegt sind Impressum, Datenschutz und Cookie-Richtlinie.</Alert><div className="button-row"><ButtonLink href="/datenschutz" variant="secondary">Datenschutz</ButtonLink><ButtonLink href="/impressum" variant="secondary">Impressum</ButtonLink></div></div>}
  </Container></Section>;
}

function LegalCopy() {
  return <div className="legal-copy"><h2>Verantwortlicher</h2><p>RheinWerk Industrieservice GmbH, Rheinwerkstraße 12, 68169 Mannheim, service@rheinwerk-industrieservice.example, +49 621 00000-0.</p><h2>Zwecke und Rechtsgrundlagen</h2><p>Wir verarbeiten die Angaben aus der Serviceanfrage, um die Anfrage zu prüfen, den Einsatz zu planen und mit Ihnen abzustimmen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO für die Vertragsanbahnung sowie Art. 6 Abs. 1 lit. a DSGVO für die im Formular erteilte Zustimmung.</p><h2>Erhobene Daten</h2><p>Unternehmen, Name der Kontaktperson, geschäftliche E-Mail-Adresse, Telefonnummer, Standortadresse, Angaben zur Anlage, Beschreibung der Störung, Dringlichkeit, gewünschter Einsatztermin, Kunden- oder SLA-Vertragsnummer sowie hochgeladene Fotos und Dokumente.</p><h2>Empfänger</h2><p>Innerhalb des Unternehmens erhalten Service Desk und Einsatzplanung Zugriff, dazu die eingesetzten Servicetechniker. Eine Übermittlung an Dritte erfolgt nur, wenn sie zur Auftragsdurchführung erforderlich oder gesetzlich vorgeschrieben ist.</p><h2>Speicherdauer</h2><p>Anfragen, aus denen kein Auftrag entsteht, werden nach Abschluss der Prüfung gelöscht. Auftragsbezogene Unterlagen unterliegen den gesetzlichen Aufbewahrungsfristen.</p><h2>Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine erteilte Zustimmung können Sie jederzeit widerrufen. Zudem können Sie sich bei der zuständigen Aufsichtsbehörde beschweren.</p><h2>Demo-Anruf bei der KI-Assistentin „Mira“</h2><p>Die Telefonnummer des Service Desks auf dieser Website öffnet einen Demo-Anruf. Erst nach Ihrer Bestätigung mit „Einverstanden, anrufen“ verbindet sich der Browser mit der KI-Assistentin. Ihre Sprache wird dabei an ElevenLabs (Sprachplattform, Verarbeitung auch in den USA) übertragen und dort in Text umgewandelt; die Antworten erzeugt ein Sprachmodell. Mira fragt nur die Angaben einer Serviceanfrage ab: Unternehmen, Kontaktperson, geschäftliche Telefonnummer und E-Mail-Adresse, Standort, Anlage, Anliegen, Dringlichkeit, Terminwunsch sowie Kunden- oder SLA-Vertragsnummer. Audio wird nicht gespeichert. Das Gespräch wird als Text 30 Tage gespeichert und automatisch zusammengefasst. Entsteht im Gespräch eine Anfrage, bleiben Zusammenfassung und Anfrage wie eine Serviceanfrage erhalten. Ohne Anfrage löschen wir Zusammenfassung und Gesprächsdaten 12 Monate nach Gesprächsende automatisch. Für die Begrenzung der Gesprächsminuten speichern wir einen verschlüsselten Kurzwert Ihrer IP-Adresse (nicht die Adresse selbst) für höchstens 90 Tage. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO für Anfragen sowie Art. 6 Abs. 1 lit. f DSGVO für die Missbrauchsbegrenzung. Mira ist eine KI und sagt das zu Beginn jedes Gesprächs.</p><h2>Karte</h2><p>Der Kartenausschnitt auf der Kontaktseite lädt Kartenkacheln von OpenStreetMap. Dabei wird Ihre IP-Adresse an den Kachelserver übertragen. Details stehen in der <Link href="/cookie-richtlinie">Cookie-Richtlinie</Link>.</p></div>;
}

export function NotFoundPage() {
  return <Section tone="page"><Container><Eyebrow>Fehler 404</Eyebrow><h1>Diese Seite gibt es nicht</h1><p className="lead">Die Adresse führt zu keinem Inhalt. Wenn Sie eine Störung melden wollen, ist die Serviceanfrage der direkte Weg, oder Sie rufen den Service Desk an.</p><div className="button-row"><ButtonLink href="/serviceanfrage" icon="arrow-right">Anfrage senden</ButtonLink><ButtonLink href="/" variant="secondary">Zur Startseite</ButtonLink></div><div className="card-grid card-grid--3"><ServiceCard icon="wrench" title="Leistungen" body="Inspektion, Wartung, Diagnose und Reparatur." href="/leistungen" /><ServiceCard icon="location" title="Branchen" body="Industrie, Logistik, Lebensmittelproduktion." href="/anlagen-und-branchen" /><ServiceCard icon="phone" title="Kontakt" body="Service Desk, Anschrift, Servicezeiten." href="/kontakt" /></div></Container></Section>;
}
