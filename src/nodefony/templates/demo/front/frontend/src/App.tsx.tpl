import { useEffect, useState, type CSSProperties } from "react";
import { NODEFONY_LOGO } from "./brand";
import {
  DEMO_ABOUT_PATH,
  docUrl,
  parseDemoAbout,
  type IDemoAbout,
} from "./about";
import { debugBarControl, type IDebugBarControl } from "./debugBar";
import "./demo.css";

/**
 * Accueil de la démo (`/demo`) — le haut de l'accueil du cœur, en React.
 *
 * Guide pour un agent : la page lit son identité à `/demo/api/about`
 * (`DemoController`, type partagé `IDemoAbout`) et pilote la barre de debug
 * par sa poignée publiée (`debugBar.ts`), sans importer le widget. Le
 * catalogue des démos et les onglets de métier arrivent dans les lots
 * suivants (#747).
 */
export function App() {
  const about = useAbout();
  // Le logo vient du paquet (`brand.ts`) : la feuille le lit par variable.
  const logo: CSSProperties & Record<"--demo-logo", string> = {
    "--demo-logo": `url(${JSON.stringify(NODEFONY_LOGO)})`,
  };
  return (
    <div style={logo}>
      <div className="reading" aria-hidden="true" />
      <Topbar about={about} />
      <main>
        <Hero />
      </main>
    </div>
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
function Topbar({ about }: { about: IDemoAbout | null }) {
  const appName = about?.app.name ?? "<%= it.appName %>";
  // PAS d'`aria-label` : le nom accessible est le CONTENU. L'étiquette « démo »
  // disparaît sous 1200 px, et un libellé fixe ne contiendrait plus le texte
  // visible à l'une des deux largeurs (WCAG 2.5.3, « label in name »).
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
        </span>
        <span className="id id-nf" aria-hidden="true">
          <span className="brand-logo" />
          <span className="brand-name">Nodefony</span>
          {about && (
            <span className="tag ver" title="Version de Nodefony installée">
              v{about.nodefony.version}
            </span>
          )}
        </span>
      </a>
      <nav className="topnav" aria-label="Navigation de la démo">
        <a
          className="doc"
          href={
            about
              ? docUrl(about.nodefony.version)
              : "https://nodefony.github.io/nodefony-core/"
          }
        >
          Documentation
        </a>
        <a className="gh" href="https://github.com/nodefony/nodefony-core">
          GitHub
        </a>
        <DebugBarButtons />
      </nav>
    </header>
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
    <div className="dbg" role="group" aria-label="Barre de debug (développement)">
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
    </div>
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
