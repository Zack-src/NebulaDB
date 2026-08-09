import { useMemo, useRef, useState } from "react";
import "./landing/landing.css";
import { BrandMark } from "./ui/BrandMark.js";
import { Button } from "./ui/Button.js";
import { Badge } from "./ui/Badge.js";
import { Card } from "./ui/Card.js";
import { Reveal } from "./landing/Reveal.js";
import { CountUp } from "./landing/CountUp.js";
import { ScrollProgress } from "./landing/ScrollProgress.js";
import { usePointerGlow, useActiveStep } from "./landing/useReveal.js";
import {
  CodeIcon,
  DatabaseIcon,
  LayersIcon,
  SparklesIcon,
  UsersIcon,
  ZapIcon,
  CheckIcon,
  ClockIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  MousePointerIcon,
  MoveIcon,
  KeyIcon,
  LinkIcon,
} from "./Icons.js";

export interface LandingPageProps {
  onOpenApp: () => void;
  onOpenLogin: () => void;
  isLoggedIn?: boolean;
}

const NAV_LINKS = [
  { href: "#features", label: "Fonctionnalités" },
  { href: "#how", label: "Comment ça marche" },
  { href: "#pricing", label: "Tarifs" },
  { href: "#faq", label: "FAQ" },
];

const MARQUEE_ITEMS = [
  "PostgreSQL",
  "MySQL",
  "SQL Server",
  "DBML",
  "Yjs CRDT",
  "Auto-hébergé",
  "Self-Hosted",
  "MIT Open Source",
];

const HOW_STEPS = [
  {
    title: "Modélisez visuellement ou en DBML",
    body: "Glissez des tables sur le canvas ou écrivez du DBML directement — les deux vues restent parfaitement synchronisées en temps réel, sans étape d'export intermédiaire.",
    icon: DatabaseIcon,
  },
  {
    title: "Collaborez sans conflit",
    body: "Chaque édition passe par un CRDT Yjs : plusieurs personnes modifient le même schéma en simultané, les curseurs se voient en direct, et rien n'est jamais écrasé.",
    icon: UsersIcon,
  },
  {
    title: "Exportez votre SQL prêt à migrer",
    body: "Générez du DDL PostgreSQL, MySQL ou SQL Server en un clic, ou embarquez votre propre exporteur via le système de plugins — le schéma reste la seule source de vérité.",
    icon: CodeIcon,
  },
];

const BENTO_FEATURES = [
  {
    icon: DatabaseIcon,
    tone: "primary",
    span: "md:col-span-2",
    title: "Canvas relationnel en temps réel",
    body: "Déplacez des tables, tracez des relations, organisez des zones — chaque changement se répercute instantanément dans le DBML et chez tous vos collaborateurs connectés.",
  },
  {
    icon: UsersIcon,
    tone: "purple",
    span: "",
    title: "Collaboration CRDT",
    body: "Yjs fusionne les éditions concurrentes sans verrou ni conflit.",
  },
  {
    icon: ShieldCheckIcon,
    tone: "cyan",
    span: "",
    title: "Auto-hébergé & maîtrisé",
    body: "Vos schémas restent sur votre serveur. Sessions, permissions et invitations d'équipe inclus.",
  },
  {
    icon: LayersIcon,
    tone: "amber",
    span: "",
    title: "Zones, notes & historique",
    body: "Organisez visuellement vos schémas et remontez dans l'historique des versions à tout moment.",
  },
  {
    icon: CodeIcon,
    tone: "primary",
    span: "md:col-span-2",
    title: "DBML natif & exports SQL",
    body: "Import/export DBML et SQL (PostgreSQL, MySQL, SQL Server) sans perte, plus un système de plugins pour vos propres formats.",
  },
];

const TONE_CLASSES: Record<string, string> = {
  primary: "bg-primary/20 text-primary",
  purple: "bg-accent-purple/20 text-accent-purple",
  cyan: "bg-accent-cyan/20 text-accent-cyan",
  amber: "bg-warning/20 text-warning",
};

const FAQ_ITEMS = [
  {
    q: "AthanorDB est-il vraiment open-source ?",
    a: "Oui : le moteur DBML, l'éditeur, le serveur de synchronisation et l'application web sont 100% open-source sous licence MIT.",
  },
  {
    q: "Où sont stockées mes données ?",
    a: "Sur votre propre serveur auto-hébergé — AthanorDB ne dépend d'aucun service tiers pour fonctionner.",
  },
  {
    q: "Quels dialectes SQL sont pris en charge ?",
    a: "Import et export directs vers PostgreSQL, MySQL et SQL Server, avec DBML comme format pivot.",
  },
  {
    q: "Comment fonctionne la collaboration en temps réel ?",
    a: "Chaque schéma est un document Yjs (CRDT) : les éditions simultanées fusionnent automatiquement, sans verrouillage ni perte de données, et se reconnectent seules après une coupure réseau.",
  },
  {
    q: "Puis-je travailler hors-ligne ?",
    a: "Pas aujourd'hui. L'application a besoin d'une connexion à votre serveur AthanorDB. Un onglet déjà ouvert encaisse une coupure réseau — vos modifications restent en mémoire et se resynchronisent à la reconnexion — mais il n'existe pas de mode hors-ligne persistant : fermer l'onglet pendant une coupure perd les modifications non synchronisées.",
  },
];

/** users/orders draggable relationship preview inside the hero — the one place a visitor touches the actual canvas interaction model before signing in. */
function InteractivePreview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tablePos, setTablePos] = useState({ users: { x: 40, y: 46 }, orders: { x: 320, y: 108 } });
  const draggingRef = useRef<{ key: "users" | "orders"; offsetX: number; offsetY: number } | null>(null);

  const clampTo = (x: number, y: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const maxX = (bounds?.width ?? 560) - 224;
    const maxY = (bounds?.height ?? 260) - 150;
    return { x: Math.max(8, Math.min(maxX, x)), y: Math.max(8, Math.min(maxY, y)) };
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const key = e.currentTarget.dataset.tableKey as "users" | "orders";
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = { key, offsetX: e.clientX - tablePos[key].x, offsetY: e.clientY - tablePos[key].y };
  };

  const onMove = (e: React.PointerEvent) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = clampTo(e.clientX - bounds.left - drag.offsetX, e.clientY - bounds.top - drag.offsetY);
    setTablePos((prev) => ({ ...prev, [drag.key]: next }));
  };

  const endDrag = () => {
    draggingRef.current = null;
  };

  const path = useMemo(() => {
    const startX = tablePos.users.x + 220;
    const startY = tablePos.users.y + 70;
    const endX = tablePos.orders.x;
    const endY = tablePos.orders.y + 70;
    const midX = startX + (endX - startX) / 2;
    return { d: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`, startX, startY, endX, endY };
  }, [tablePos]);

  return (
    <div className="relative w-full max-w-5xl rounded-2xl border border-border-strong/90 glass-panel p-2 shadow-2xl glow-indigo">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface/90 rounded-t-xl border-b border-border/60 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-danger/80" />
          <span className="w-3 h-3 rounded-full bg-warning/80" />
          <span className="w-3 h-3 rounded-full bg-success/80" />
          <span className="ml-2 font-mono text-[11px] text-text-secondary">athanordb://canvas/apercu</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-primary font-semibold text-[11px]">
          <MoveIcon size={13} />
          <span>Essayez : déplacez une table</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative bg-bg-canvas h-[340px] sm:h-[400px] rounded-b-xl overflow-hidden p-6 text-left touch-none"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute inset-0 bg-[radial-gradient(#292d3f_1.2px,transparent_1.2px)] [background-size:18px_18px] opacity-40" />

        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          <path
            d={path.d}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2.5"
            className="ref-edge-flow-path"
            style={{ animation: "ref-edge-flow 0.8s linear infinite" }}
          />
          <circle cx={path.startX} cy={path.startY} r="4" fill="#6366f1" />
          <circle cx={path.endX} cy={path.endY} r="4" fill="#6366f1" />
        </svg>

        <div
          className="absolute z-20 w-[220px] rounded-xl border border-primary/60 bg-surface/95 shadow-xl overflow-hidden cursor-grab active:cursor-grabbing transition-shadow hover:shadow-2xl select-none"
          style={{ left: tablePos.users.x, top: tablePos.users.y }}
          data-table-key="users"
          onPointerDown={startDrag}
        >
          <div className="bg-primary/20 px-3.5 py-2 border-b border-primary/30 flex justify-between items-center">
            <span className="font-bold text-xs text-primary font-mono flex items-center gap-1.5">
              <DatabaseIcon size={13} /> users
            </span>
            <span className="text-[10px] text-text-muted font-mono">4 colonnes</span>
          </div>
          <div className="p-3 text-xs font-mono space-y-1.5 text-text-secondary">
            <div className="flex justify-between items-center text-text font-semibold">
              <span className="text-warning flex items-center gap-1"><KeyIcon size={12} /> id</span>
              <span className="text-text-muted text-[10px]">uuid [pk]</span>
            </div>
            <div className="flex justify-between items-center"><span>email</span><span className="text-text-muted text-[10px]">varchar</span></div>
            <div className="flex justify-between items-center"><span>display_name</span><span className="text-text-muted text-[10px]">varchar</span></div>
            <div className="flex justify-between items-center"><span>created_at</span><span className="text-text-muted text-[10px]">timestamp</span></div>
          </div>
        </div>

        <div
          className="absolute z-20 w-[220px] rounded-xl border border-accent-purple/60 bg-surface/95 shadow-xl overflow-hidden cursor-grab active:cursor-grabbing transition-shadow hover:shadow-2xl select-none"
          style={{ left: tablePos.orders.x, top: tablePos.orders.y }}
          data-table-key="orders"
          onPointerDown={startDrag}
        >
          <div className="bg-accent-purple/20 px-3.5 py-2 border-b border-accent-purple/30 flex justify-between items-center">
            <span className="font-bold text-xs text-accent-purple font-mono flex items-center gap-1.5">
              <DatabaseIcon size={13} /> orders
            </span>
            <span className="text-[10px] text-text-muted font-mono">3 colonnes</span>
          </div>
          <div className="p-3 text-xs font-mono space-y-1.5 text-text-secondary">
            <div className="flex justify-between items-center text-text font-semibold">
              <span className="text-warning flex items-center gap-1"><KeyIcon size={12} /> id</span>
              <span className="text-text-muted text-[10px]">uuid [pk]</span>
            </div>
            <div className="flex justify-between items-center text-primary font-semibold">
              <span className="flex items-center gap-1"><LinkIcon size={10} /> user_id</span>
              <span className="text-text-muted text-[10px]">uuid [ref]</span>
            </div>
            <div className="flex justify-between items-center"><span>total_amount</span><span className="text-text-muted text-[10px]">decimal</span></div>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 glass-card px-3 py-1.5 rounded-lg border border-primary/40 text-[11px] text-text font-semibold flex items-center gap-2 shadow-sm pointer-events-none">
          <MousePointerIcon size={13} className="text-primary animate-bounce" />
          <span>Attrapez l'en-tête d'une table</span>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ onOpenApp, onOpenLogin, isLoggedIn = false }: LandingPageProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const heroGlowRef = usePointerGlow<HTMLDivElement>();
  const { active: activeStep, setStepRef } = useActiveStep(HOW_STEPS.length);
  const ActiveStepIcon = HOW_STEPS[activeStep].icon;

  return (
    <div className="landing-page min-h-screen bg-bg text-text font-sans selection:bg-primary/30 selection:text-white flex flex-col">
      <ScrollProgress />

      {/* Header */}
      <header className="h-14 sticky top-0 z-50 glass-panel border-b border-border/80 px-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 cursor-pointer" onClick={onOpenApp}>
          <BrandMark size={26} />
          <span className="text-sm font-extrabold tracking-tight text-text">AthanorDB</span>
          <Badge tone="admin" className="hidden sm:inline-flex">v0.0.1 Open-Core</Badge>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-text-secondary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-text transition-colors">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <Button variant="primary" size="sm" onClick={onOpenApp} className="text-xs">
              Ouvrir mon espace →
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onOpenLogin} className="text-xs hidden sm:inline-flex">
                Connexion
              </Button>
              <Button variant="primary" size="sm" onClick={onOpenApp} className="text-xs">
                Commencer <SparklesIcon size={13} />
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section
        ref={heroGlowRef}
        className="landing-cursor-glow relative pt-16 pb-20 px-6 overflow-hidden gradient-bg-hero flex flex-col items-center text-center"
      >
        <div className="landing-grain" />
        <div className="landing-blob-a absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[280px] bg-primary/15 blur-[120px] rounded-full pointer-events-none" />
        <div className="landing-blob-b absolute top-1/3 right-[10%] w-[360px] h-[220px] bg-accent-purple/15 blur-[110px] rounded-full pointer-events-none" />

        <Reveal from="scale">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-card border border-primary/40 text-xs font-semibold text-primary mb-6 shadow-sm">
            <ZapIcon size={13} />
            <span>Auto-hébergé & synchronisation temps réel Yjs CRDT</span>
          </div>
        </Reveal>

        <h1 className="max-w-4xl text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] mb-6">
          <span className="landing-headline-row block">
            <span style={{ animationDelay: "0ms" }}>Concevez vos bases de données avec</span>
          </span>
          <span className="landing-headline-row block">
            <span className="gradient-text" style={{ animationDelay: "120ms" }}>
              un moteur DBML ultra-rapide.
            </span>
          </span>
        </h1>

        <Reveal delay={200}>
          <p className="max-w-2xl text-sm sm:text-base text-text-secondary leading-relaxed mb-8">
            AthanorDB combine l'édition visuelle de schémas relationnels, la collaboration temps réel sans conflit et
            l'exportation SQL directe. 100% de contrôle sur vos données, auto-hébergé.
          </p>
        </Reveal>

        <Reveal delay={320}>
          <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
            <div className="landing-magnetic rounded-lg">
              <Button variant="glow" size="lg" onClick={onOpenApp} className="px-7 py-3 text-sm font-bold">
                Commencer gratuitement <SparklesIcon size={15} />
              </Button>
            </div>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-border-strong/80 bg-surface/60 text-text-secondary hover:text-text hover:bg-surface-hover text-xs font-semibold transition-all shadow-sm"
            >
              <CodeIcon size={15} /> GitHub Open-Source <ExternalLinkIcon size={12} />
            </a>
          </div>
        </Reveal>

        <Reveal delay={420} className="w-full flex flex-col items-center">
          <InteractivePreview />
        </Reveal>

        <div className="landing-marquee mt-14 w-full max-w-3xl overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <div className="landing-marquee-track flex items-center gap-8 w-max text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
              <span key={i} className="flex items-center gap-8 shrink-0">
                {item}
                <span className="text-border-strong">•</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — pinned step sequence */}
      <section id="how" className="py-24 px-6 max-w-6xl mx-auto w-full border-t border-border/50">
        <Reveal>
          <div className="text-center mb-16">
            <Badge tone="admin" className="mb-3">Le flux de travail</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">Comment ça marche</h2>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-12 items-start">
          <div className="hidden md:flex sticky top-24 self-start w-full aspect-square rounded-2xl border border-border-strong/80 glass-panel items-center justify-center shadow-xl">
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${TONE_CLASSES.primary}`}>
              <ActiveStepIcon size={36} />
            </div>
            <span className="absolute bottom-5 text-[11px] font-mono text-text-muted">
              étape {activeStep + 1} / {HOW_STEPS.length}
            </span>
          </div>

          <div className="flex flex-col gap-14">
            {HOW_STEPS.map((step, i) => (
              <div
                key={step.title}
                ref={setStepRef(i)}
                data-active={activeStep === i}
                className="landing-step pl-6 py-1"
              >
                <span className="landing-step-index absolute -left-[15px] top-1 w-7 h-7 rounded-full bg-surface-raised border border-border-strong flex items-center justify-center text-[11px] font-bold text-text-secondary">
                  {i + 1}
                </span>
                <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed max-w-lg">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bento feature grid */}
      <section id="features" className="py-20 px-6 max-w-6xl mx-auto w-full border-t border-border/50">
        <Reveal>
          <div className="text-center mb-16">
            <Badge tone="admin" className="mb-3">Architecture & Design</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Une expérience conçue pour les développeurs exigeants
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto text-xs sm:text-sm">
              Sur votre infrastructure, zéro latence perçue, génération de code instantanée et collaboration sans conflit.
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {BENTO_FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={i * 80} className={feature.span}>
              <Card variant="glass" interactive className="p-6 h-full">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${TONE_CLASSES[feature.tone]}`}>
                  <feature.icon size={20} />
                </div>
                <h3 className="text-base font-bold mb-2">{feature.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{feature.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Stat band */}
      <section className="py-16 px-6 border-t border-y border-border/50 bg-surface/40">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <Reveal delay={0}>
            <div className="text-3xl sm:text-4xl font-black text-primary mb-1">
              <CountUp to={100} suffix="%" />
            </div>
            <p className="text-xs text-text-muted">Open-source (MIT)</p>
          </Reveal>
          <Reveal delay={80}>
            <div className="text-3xl sm:text-4xl font-black text-accent-purple mb-1">
              <CountUp to={3} suffix="+" />
            </div>
            <p className="text-xs text-text-muted">Dialectes SQL en export</p>
          </Reveal>
          <Reveal delay={160}>
            <div className="text-3xl sm:text-4xl font-black text-accent-cyan mb-1">CRDT</div>
            <p className="text-xs text-text-muted">Fusion temps réel sans conflit</p>
          </Reveal>
          <Reveal delay={240}>
            <div className="text-3xl sm:text-4xl font-black text-success mb-1">0 €</div>
            <p className="text-xs text-text-muted">Auto-hébergement gratuit à vie</p>
          </Reveal>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 max-w-6xl mx-auto w-full">
        <Reveal>
          <div className="text-center mb-16">
            <Badge tone="admin" className="mb-3">Tarification transparente</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Gratuit, open source, auto-hébergé.
            </h2>
            <p className="text-text-secondary max-w-lg mx-auto text-xs sm:text-sm">
              Tout ce qui est listé ci-dessous avec une coche existe aujourd'hui, dans la version que vous pouvez
              installer maintenant. Ce qui est marqué d'une horloge est prévu et n'est pas encore disponible.
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Reveal delay={0}>
            <Card variant="glow" className="p-7 flex flex-col justify-between relative border-primary h-full">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-[10px] font-extrabold uppercase text-white tracking-wider shadow-sm">
                Disponible aujourd'hui
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Community</div>
                <div className="text-3xl font-black mb-1">0 € <span className="text-xs text-text-muted font-normal">/ mois</span></div>
                <p className="text-xs text-text-secondary mb-6">Auto-hébergement gratuit & open source sous licence MIT.</p>
                <ul className="space-y-3 text-xs text-text mb-8">
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-primary shrink-0" /> Tables & schémas illimités</li>
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-primary shrink-0" /> Import / export DBML & SQL</li>
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-primary shrink-0" /> Édition multi-utilisateur temps réel</li>
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-primary shrink-0" /> Équipes, permissions & historique</li>
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-primary shrink-0" /> Vos données sur votre serveur</li>
                </ul>
              </div>
              <Button variant="primary" onClick={onOpenApp} className="w-full text-xs">Utiliser gratuitement</Button>
            </Card>
          </Reveal>

          <Reveal delay={100}>
            <Card variant="default" className="p-7 flex flex-col justify-between h-full">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Cloud géré</div>
                <div className="text-3xl font-black mb-1">En préparation</div>
                <p className="text-xs text-text-secondary mb-6">
                  Une offre hébergée par nos soins, pour les équipes qui ne veulent pas administrer de serveur.
                </p>
                <ul className="space-y-3 text-xs text-text-secondary mb-8">
                  <li className="flex items-center gap-2"><ClockIcon size={14} className="text-text-muted shrink-0" /> Serveur géré & sauvegardes automatiques</li>
                  <li className="flex items-center gap-2"><ClockIcon size={14} className="text-text-muted shrink-0" /> Facturation par utilisateur</li>
                  <li className="flex items-center gap-2"><ClockIcon size={14} className="text-text-muted shrink-0" /> Mises à jour appliquées pour vous</li>
                </ul>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed border-t border-border/60 pt-4">
                Pas encore ouvert : aucune inscription, aucun essai, aucun paiement. L'auto-hébergement est
                aujourd'hui le seul mode de déploiement.
              </p>
            </Card>
          </Reveal>

          <Reveal delay={200}>
            <Card variant="default" className="p-7 flex flex-col justify-between h-full">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-accent-purple mb-2">Entreprise</div>
                <div className="text-3xl font-black mb-1">Sur demande</div>
                <p className="text-xs text-text-secondary mb-6">Pour les organisations avec des exigences de sécurité et de conformité renforcées.</p>
                <ul className="space-y-3 text-xs text-text-secondary mb-8">
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-accent-purple shrink-0" /> Instance sur votre propre infrastructure</li>
                  <li className="flex items-center gap-2"><CheckIcon size={14} className="text-accent-purple shrink-0" /> Journal d'audit des actions sensibles</li>
                  <li className="flex items-center gap-2"><ClockIcon size={14} className="text-text-muted shrink-0" /> Authentification SSO (SAML / OIDC)</li>
                  <li className="flex items-center gap-2"><ClockIcon size={14} className="text-text-muted shrink-0" /> Engagement de disponibilité contractuel</li>
                </ul>
              </div>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border border-border hover:border-accent-purple hover:text-text transition-colors"
              >
                Ouvrir une discussion <ExternalLinkIcon size={12} />
              </a>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 px-6 max-w-3xl mx-auto w-full">
        <Reveal>
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Foire aux questions</h2>
            <p className="text-xs text-text-secondary">Questions fréquentes sur AthanorDB.</p>
          </div>
        </Reveal>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => (
            <Reveal key={item.q} delay={idx * 60}>
              <div className="glass-card rounded-xl overflow-hidden border border-border/60">
                <button
                  onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                  className="w-full p-4 text-left flex items-center justify-between text-xs font-semibold hover:bg-surface-hover/50 transition-colors"
                  aria-expanded={activeFaq === idx}
                >
                  <span>{item.q}</span>
                  <ChevronDownIcon
                    size={15}
                    className={`transition-transform duration-200 ${activeFaq === idx ? "rotate-180 text-primary" : "text-text-muted"}`}
                  />
                </button>
                {activeFaq === idx && (
                  <div className="px-4 pb-4 text-xs text-text-secondary border-t border-border/40 pt-3 leading-relaxed animate-modal-in">
                    {item.a}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing CTA banner */}
      <section className="px-6 pb-20">
        <Reveal from="scale">
          <div className="max-w-5xl mx-auto rounded-3xl border border-primary/30 glass-panel px-8 py-14 text-center relative overflow-hidden">
            <div className="landing-blob-a absolute -top-10 left-1/2 -translate-x-1/2 w-[420px] h-[200px] bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
            <h2 className="relative text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
              Prêt à structurer vos données ?
            </h2>
            <p className="relative text-text-secondary text-xs sm:text-sm mb-8 max-w-md mx-auto">
              Ouvrez votre premier schéma en quelques secondes — aucune carte bancaire requise.
            </p>
            <div className="relative landing-magnetic inline-block rounded-lg">
              <Button variant="glow" size="lg" onClick={onOpenApp} className="px-8 py-3 text-sm font-bold">
                Commencer gratuitement <SparklesIcon size={15} />
              </Button>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border/60 bg-surface/60 py-8 px-6 text-xs text-text-muted">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark size={20} />
            <span className="font-bold text-text">AthanorDB</span>
            <span>— Éditeur de schémas DBML open-source, auto-hébergé</span>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <button onClick={onOpenApp} className="hover:text-text transition-colors">Ouvrir l'application</button>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-text transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
