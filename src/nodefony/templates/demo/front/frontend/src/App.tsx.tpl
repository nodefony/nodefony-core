import { useEffect, useState, type CSSProperties } from "react";
import { NODEFONY_LOGO } from "./brand";
import { DEMOS, type IDemoEntry } from "../../demos";
import {
  DEMO_ABOUT_PATH,
  REPO_URL,
  docUrl,
  parseDemoAbout,
  type IDemoAbout,
} from "./about";
import { Catalogue } from "./Catalogue";
import { debugBarControl, type IDebugBarControl } from "./debugBar";
import { useCurrentSection, usePointerLight } from "./effects";
import { ChatLesson } from "./chat/ChatLesson";
import { FirstStepsLesson } from "./first/FirstStepsLesson";
import { SseLesson } from "./sse/SseLesson";
import { Account } from "./kit/Account";
import { applyTheme, readTheme, type DemoTheme } from "./kit/theme";
import { PartnerLesson } from "./partner/PartnerLesson";
import { RoleTabs } from "./RoleTabs";
import { usePulse } from "./usePulse";
import "./demo.css";

// Le thème AVANT le premier rendu : sombre par défaut, sinon le choix retenu.
applyTheme(readTheme());

/** Les sections que la barre du haut permet d'atteindre, dans l'ordre. */
const SECTIONS = [
  { id: "roles", label: "Par où commencer" },
  { id: "realtime", label: "Temps réel" },
  { id: "catalogue", label: "Démos" },
  { id: "socle", label: "Le socle" },
  { id: "agents", label: "Pour les agents" },
] as const;

const SECTION_IDS = SECTIONS.map((section) => section.id);

/**
 * Accueil de la démo (`/demo`) — le haut de l'accueil du cœur, en React.
 *
 * Guide pour un agent : la page lit son identité à `/demo/api/about`
 * (`DemoController`, type partagé `IDemoAbout`) et pilote la barre de debug
 * par sa poignée publiée (`debugBar.ts`), sans importer le widget. Le
 * catalogue et les onglets de métier lisent l'index `modules/demo/demos.ts`
 * — une démo s'ajoute là, jamais dans la page.
 */
export function App() {
  const about = useAbout();
  // La même page sert l'accueil et les pages d'apprentissage : l'adresse
  // choisit l'écran (`DemoController.lesson` n'accepte que celles de l'index).
  const page = window.location.pathname.replace(/\/+$/u, "");
  const lesson =
    page === "/demo/chat" ||
    page === "/demo/partner" ||
    page === "/demo/first-steps" ||
    page === "/demo/sse";
  // Le logo vient du paquet (`brand.ts`) : la feuille le lit par variable.
  const logo: CSSProperties & Record<"--demo-logo", string> = {
    "--demo-logo": `url(${JSON.stringify(NODEFONY_LOGO)})`,
  };
  return (
    <div style={logo}>
      <div className="reading" aria-hidden="true" />
      <Topbar about={about} home={!lesson} />
      {page === "/demo/chat" ? (
        <ChatLesson about={about} />
      ) : page === "/demo/partner" ? (
        <PartnerLesson about={about} />
      ) : page === "/demo/first-steps" ? (
        <FirstStepsLesson about={about} />
      ) : page === "/demo/sse" ? (
        <SseLesson about={about} />
      ) : (
        <Home about={about} />
      )}
    </div>
  );
}

/** L'accueil : le haut de page, les métiers, le catalogue vivant, le socle. */
function Home({ about }: { about: IDemoAbout | null }) {
  const version = about?.nodefony.version ?? null;
  usePointerLight(".card");
  const pulse = usePulse();
  return (
    <>
      <main>
        <Hero />
        <RoleTabs version={version} />
        <Catalogue pulse={pulse} />
        <Foundation />
        <Agents />
        <footer>
          <span>
            Démo livrée par <code>create app --demo</code> — la retirer :
            supprimer <code>modules/demo/</code> et sa ligne du manifeste.
          </span>
          <a href="https://nodefony.net">nodefony.net</a>
        </footer>
      </main>
    </>
  );
}

/** Identité lue au démarrage du serveur ; `null` tant qu'elle n'est pas là. */
function useAbout(): IDemoAbout | null {
  const [about, setAbout] = useState<IDemoAbout | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(DEMO_ABOUT_PATH, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => setAbout(parseDemoAbout(body)))
      .catch(() => {
        // Annulée au démontage, ou serveur injoignable : la barre reste sur
        // son identité minimale, sans versions.
      });
    return () => abort.abort();
  }, []);
  return about;
}

/**
 * Barre du haut : l'identité de l'APPLICATION, qui cède la place à NODEFONY
 * quand la marque du haut de page s'y pose au défilement (CSS pur,
 * `view-timeline`).
 */
function Topbar({
  about,
  home,
}: {
  about: IDemoAbout | null;
  home: boolean;
}) {
  const appName = about?.app.name ?? "<%= it.appName %>";
  const current = useCurrentSection(SECTION_IDS);
  // PAS d'`aria-label` : le nom accessible est le CONTENU des DEUX identités.
  // L'étiquette « démo » disparaît sous 1200 px, et la barre bascule vers
  // Nodefony au défilement : seul le contenu entier contient le texte visible
  // dans chaque état (WCAG 2.5.3, « label in name »). La bascule joue donc sur
  // l'opacité, jamais sur `visibility`, qui retirerait une identité du nom.
  return (
    <header className="topbar">
      <a className="brand" href="/demo">
        <span className="id id-app">
          {/* Espaces entre les éléments : sans eux, le texte lu est
              « mon-appdémov0.1.0 » et ne correspond plus au nom accessible. */}
          <span className="brand-name">{appName}</span>{" "}
          <span className="tag">démo</span>{" "}
          {about && (
            <span className="tag ver" title="Version de l'application">
              v{about.app.version}
            </span>
          )}
        </span>{" "}
        <span className="id id-nf">
          <span className="brand-logo" />
          <span className="brand-name">Nodefony</span>{" "}
          {about && (
            <span className="tag ver" title="Version de Nodefony installée">
              v{about.nodefony.version}
            </span>
          )}
        </span>
      </a>
      <nav className="topnav" aria-label="Navigation de la démo">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={home ? `#${section.id}` : `/demo#${section.id}`}
            aria-current={current === section.id ? "true" : undefined}
          >
            {section.label}
          </a>
        ))}
        <span className="topnav-sep" aria-hidden="true" />
        <a className="ext" href={docUrl(about?.nodefony.version ?? null)}>
          Documentation
        </a>
        <a className="ext" href={REPO_URL}>
          GitHub
        </a>
      </nav>
      <div className="topbar-tools">
        <div className="tools" role="group" aria-label="Affichage">
          <ThemeButton />
          <DebugBarButtons />
        </div>
        <Account loginPath={about?.loginPath ?? null} />
      </div>
    </header>
  );
}

/** Sombre ou clair : le choix est retenu par le navigateur. */
function ThemeButton() {
  const [theme, setTheme] = useState<DemoTheme>(readTheme);
  const next: DemoTheme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Passer en thème clair" : "Passer en thème sombre";
  return (
    <button
      type="button"
      className="dbg-btn"
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next, true);
        setTheme(next);
      }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Les deux boutons de la barre de debug — afficher/cacher, réduire en
 * pastille. Rendus seulement si la barre est montée (développement).
 */
function DebugBarButtons() {
  const [control, setControl] = useState<IDebugBarControl | null>(null);
  const [visible, setVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    // La barre est injectée par le serveur à côté de la page : elle peut
    // publier sa poignée juste après le premier rendu.
    const frame = requestAnimationFrame(() => {
      const found = debugBarControl();
      setControl(found);
      if (found) setVisible(found.isVisible());
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  if (control === null) return null;
  return (
    <>
      <button
        type="button"
        className="dbg-btn"
        aria-pressed={visible}
        aria-label="Afficher ou cacher la barre de debug"
        title="Afficher ou cacher la barre de debug"
        onClick={() => {
          control.setVisible(!visible);
          setVisible(!visible);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2l1.9 1.9M16 2l-1.9 1.9" />
          <path d="M9 7.1V6a3 3 0 0 1 6 0v1.1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
          <path d="M12 20v-9M6.5 9H3M6 13H2M6 17H3M17.5 9H21M18 13h4M18 17h3" />
        </svg>
      </button>
      <button
        type="button"
        className="dbg-btn"
        disabled={!visible}
        aria-pressed={minimized}
        aria-label={
          minimized
            ? "Déplier la barre de debug"
            : "Réduire la barre de debug en pastille"
        }
        title={
          minimized
            ? "Déplier la barre de debug"
            : "Réduire la barre de debug en pastille"
        }
        onClick={() => {
          if (minimized) control.restore();
          else control.minimize();
          setMinimized(!minimized);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
        </svg>
      </button>
    </>
  );
}

/** Le haut de l'accueil du cœur, sans les fronts ni Studio. */
function Hero() {
  return (
    <div className="hero">
      <div className="hero-mark">
        <img
          className="hero-logo"
          src={NODEFONY_LOGO}
          alt="Logo Nodefony"
          draggable={false}
        />
        <h1>Le framework Node.js fullstack</h1>
      </div>
      <p className="sub">
        Temps réel natif · développement agentic-ready · socle TypeScript
        isomorphe
      </p>
      <p className="sig">
        Une action de contrôleur. Deux transports. La même session, la même
        sécurité, le même code.
      </p>
      <div className="badges">
        <span className="badge agentic">Agentic ready</span>
        <span className="badge">Node.js ≥ 24</span>
        <span className="badge">TypeScript strict</span>
        <span className="badge">ESM only</span>
        <span className="badge">Licence Apache 2.0</span>
      </div>
      <div
        className="install"
        role="img"
        aria-label="Commande : npx nodefony create app mon-app --demo"
      >
        <span className="p">$</span>
        <span>
          npx nodefony create app mon-app <b>--demo</b>
        </span>
      </div>
      <div className="cta">
        <a className="btn primary" href="#catalogue">
          Voir les démos
        </a>
      </div>
    </div>
  );
}

/** Les six briques que les démos utilisent, chacune avec les démos qui la montrent. */
const FEATURES = [
  {
    title: "Temps réel natif",
    text: "Même pipeline, même sécurité que le HTTP. Démos : chat, sonde, jeu.",
  },
  {
    title: "Sécurité par conception",
    text: "Zones du firewall, session, jeton machine. Démos : chat, API entre programmes.",
  },
  {
    title: "DI et modules",
    text: "La démo est un module privé : un dossier et une ligne du manifeste.",
  },
  {
    title: "Persistance portable",
    text: "Historique du chat en base, Drizzle par défaut.",
  },
  {
    title: "Front Vite",
    text: "Cette page est un front React servi par le framework, HMR en développement.",
  },
  {
    title: "Socle isomorphe",
    text: "Les mêmes types de messages côté serveur et navigateur, par nodefony/react.",
  },
] as const;

function Foundation() {
  return (
    <section id="socle">
      <div className="sec-head">
        <p className="kicker">Ce que les démos utilisent</p>
        <h2>Le socle, en six briques</h2>
        <p>
          Reprise courte des fonctionnalités de l'accueil du framework, chacune
          renvoyant aux démos qui la montrent.
        </p>
      </div>
      <div className="features">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="feature">
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Ce qu'un agent lit et que l'écran ne montre pas : une entrée RÉELLE de
 * l'index, imprimée depuis `demos.ts` — jamais un exemple recopié.
 */
function Agents() {
  const entry = DEMOS.find((demo) => demo.status === "ready");
  return (
    <section id="agents">
      <div className="agents-panel">
        <p className="kicker">Pour les agents</p>
        <h2 style={{ margin: "0 0 8px" }}>Une couche invisible à l'écran</h2>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          L'<code>AGENTS.md</code> de l'application renvoie à l'index des
          démos ; chaque fichier porte un TSDoc qui dit le type à utiliser, la
          doc, la commande et le skill.
        </p>
        {entry !== undefined && (
          <pre>{formatEntry(entry)}</pre>
        )}
      </div>
    </section>
  );
}

/** Imprime une entrée comme dans `demos.ts` : clés nues, chaînes entre guillemets. */
function formatEntry(entry: IDemoEntry): string {
  const lines = Object.entries(entry).map(([key, value]: [string, unknown]) => {
    const printed = Array.isArray(value)
      ? `[${value.map((item: unknown) => JSON.stringify(item)).join(", ")}]`
      : JSON.stringify(value);
    return `  ${key}: ${printed},`;
  });
  return `{\n${lines.join("\n")}\n}`;
}
