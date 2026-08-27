import { useEffect, useState, version as reactVersion } from "react";
// Les hooks `nodefony/react` sont de MINCES enveloppes sur le socle agnostique
// de `nodefony/client` — le même que consomment les vitrines Vue, Angular et
// Svelte. Deux concepts, ici comme là-bas : un fournisseur qui reçoit
// l'adresse, et un abonnement.
import {
  NodefonyProvider,
  useNodefony,
  useNodefonyChannel,
  useNodefonyChannelData,
  useNodefonyState,
} from "nodefony/react";
// Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
// page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
import "./showcase.css";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

/** Le battement du pod — cf `src/modules/test/.../LiveTickerController.ts`. */
interface Tick {
  n: number;
  ts: number;
  pid: number;
}

/** Un message du salon partagé : qui l'a écrit, depuis quelle vitrine. */
interface Message {
  texte: string;
  front: string;
  ts: number;
  pid: number;
}

/** La couleur du framework de vue — le SEUL écart de style entre les quatre. */
const ACCENT = "#61dafb";

/** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
const FRONT = "React";

/** Les quatre vitrines, pour les comparer d'un clic. */
const FRONTS = [
  { nom: "React", href: "/react/app" },
  { nom: "Vue", href: "/vue/app" },
  { nom: "Angular", href: "/angular/app" },
  { nom: "Svelte", href: "/svelte/app" },
];

/** L'état de la connexion, dit en français — un écran ne parle pas machine. */
const ETATS: Record<string, string> = {
  connected: "connecté",
  connecting: "connexion…",
  reconnecting: "reconnexion automatique…",
  disconnected: "coupé",
  error: "erreur",
};

/**
 * La section TEMPS RÉEL — la vedette de la page, et la même dans les quatre
 * vitrines aux mots du framework de vue près.
 *
 * Elle montre les DEUX choses qui font l'intérêt de cette socket, et qu'un
 * battement de cœur ne montrait pas :
 *
 *  1. **le serveur pousse à TOUT LE MONDE** — ce qu'on écrit ici apparaît dans
 *     les autres onglets, y compris ceux des trois autres vitrines. Il suffit
 *     d'ouvrir deux pages côte à côte pour le voir ;
 *  2. **une action de contrôleur, deux transports** — la même route rendue par
 *     HTTP et par la socket, côte à côte, avec le même résultat.
 */
function LiveSection() {
  const live = useNodefony();
  const state = useNodefonyState();
  const tick = useNodefonyChannelData<Tick>("live:ticker");
  const [messages, setMessages] = useState<Message[]>([]);
  const [texte, setTexte] = useState("");
  const [parHttp, setParHttp] = useState<string | null>(null);
  const [parSocket, setParSocket] = useState<string | null>(null);

  useNodefonyChannel(
    "live:salon",
    (payload) => setMessages((m) => [...m, payload as Message].slice(-6)),
    [],
  );

  const connecte = state === "connected";
  const attente = state === "connecting" || state === "reconnecting";

  const envoyer = () => {
    const dit = texte.trim();
    if (!dit) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    live.emit("live:dire", { texte: dit, front: FRONT });
    setTexte("");
  };

  /** La MÊME action, appelée par les deux portes, chronométrée des deux côtés. */
  const comparer = async () => {
    const t0 = performance.now();
    const r = await fetch(`/${FRONT.toLowerCase()}/api/data`);
    const json = (await r.json()) as { result?: unknown };
    setParHttp(
      `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(json.result ?? json, null, 2)}`,
    );
    const t1 = performance.now();
    const parLaSocket = await live.request(`/${FRONT.toLowerCase()}/api/data`);
    setParSocket(
      `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`,
    );
  };

  return (
    <section>
      <div className="sec-head">
        <p className="kicker">Temps réel</p>
        <h2>Ce que cette socket change</h2>
        <p>
          Une seule socket pour la page, ouverte par le framework. L'abonnement
          est compté par référence et rejoué à chaque reconnexion : rien de tout
          cela n'est écrit dans la page.
        </p>
      </div>

      <div className="bandeau">
        <p className="live-state">
          <span
            className={
              connecte ? "dot dot--on" : attente ? "dot dot--wait" : "dot"
            }
          />
          {ETATS[state] ?? state}
        </p>
        <p className="live-meta">
          {tick
            ? `battement du pod à ${new Date(tick.ts).toLocaleTimeString()} · process ${tick.pid}`
            : "en attente du premier battement…"}
        </p>
        <button
          className="btn btn--ghost"
          onClick={() => (connecte ? live.disconnect() : void live.connect())}
        >
          {connecte ? "Couper la connexion" : "Rétablir"}
        </button>
      </div>

      <div className="grid">
        <div className="card">
          <h3>👥 Le serveur pousse à TOUS</h3>
          <p style={{ marginBottom: "14px" }}>
            Ouvrez cette page dans un second onglet — ou dans une autre vitrine
            — et écrivez : les deux affichent la même chose, en direct. Le
            message ne repasse jamais par une requête HTTP.
          </p>
          <div className="saisie">
            <input
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && envoyer()}
              placeholder="Écrivez, puis Entrée…"
              aria-label="Message à diffuser"
            />
            <button className="counter" onClick={envoyer}>
              Envoyer
            </button>
          </div>
          <ul className="salon">
            {messages.length === 0 ? (
              <li className="vide">Rien encore — écrivez quelque chose.</li>
            ) : (
              messages.map((m, i) => (
                <li key={`${m.ts}-${i}`}>
                  <span className="qui">{m.front}</span>
                  <span>{m.texte}</span>
                  <span className="quand">
                    {new Date(m.ts).toLocaleTimeString()}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="card">
          <h3>🔀 Une action, deux transports</h3>
          <p style={{ marginBottom: "14px" }}>
            <code>GET /{FRONT.toLowerCase()}/api/data</code> appelé par HTTP,
            puis par la socket. Même route, même session, même sécurité — une
            seule action de contrôleur derrière les deux portes.
          </p>
          <button className="counter" onClick={comparer}>
            Appeler par les deux
          </button>
          <div className="deux" style={{ marginTop: "14px" }}>
            <div>
              <p className="voie">
                HTTP <em>{parHttp?.split("\n")[0] ?? ""}</em>
              </p>
              <pre className="out">
                {parHttp?.split("\n").slice(1).join("\n") ?? "—"}
              </pre>
            </div>
            <div>
              <p className="voie">
                Socket <em>{parSocket?.split("\n")[0] ?? ""}</em>
              </p>
              <pre className="out">
                {parSocket?.split("\n").slice(1).join("\n") ?? "—"}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div className="live" style={{ marginTop: "16px" }}>
        <div>
          <p className="live-why">
            Ces <strong>trois lignes</strong> sont les mêmes dans les quatre
            vitrines. Seule la syntaxe du framework de vue change : la logique
            d'abonnement vit dans <strong>nodefony/client</strong>, jamais dans
            la page.
          </p>
          <p className="hint">
            Les hooks React sont de minces enveloppes sur le même socle que Vue,
            Angular et Svelte appellent directement.
          </p>
        </div>
        <pre className="code">
          <code>{`<NodefonyProvider url="/api/live/realtime">

const état    = useNodefonyState()
const message = useNodefonyChannel("live:salon", (m) => …)`}</code>
        </pre>
      </div>
    </section>
  );
}

export function App() {
  const [count, setCount] = useState(0);
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/react/api/data");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
        const json = (await r.json()) as { result?: ApiData } & ApiData;
        if (!cancelled) {
          setData((json.result ?? json) as ApiData);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <NodefonyProvider url="/api/live/realtime">
      <div style={{ "--accent": ACCENT } as React.CSSProperties}>
        <header className="topbar">
          <a className="brand" href="/">
            <img src="/nodefony-logo.png" alt="" draggable="false" />
            nodefony-core
          </a>
          <nav className="fronts" aria-label="Les quatre vitrines">
            {FRONTS.map((f) => (
              <a
                key={f.href}
                href={f.href}
                aria-current={f.nom === "React" ? "page" : undefined}
              >
                {f.nom}
              </a>
            ))}
          </nav>
        </header>

        <main>
          <div className="hero">
            <svg
              className="logo"
              viewBox="-11.5 -10.23174 23 20.46348"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="0" cy="0" r="2.05" fill={ACCENT} />
              <g stroke={ACCENT} strokeWidth="1" fill="none">
                <ellipse rx="11" ry="4.2" />
                <ellipse rx="11" ry="4.2" transform="rotate(60)" />
                <ellipse rx="11" ry="4.2" transform="rotate(120)" />
              </g>
            </svg>
            <h1>React 19</h1>
            <p className="sub">
              Le même écran, le même socle, quatre frameworks. Servi par{" "}
              <strong>@nodefony/frontend</strong> (Vite + HMR) et alimenté par
              une seule socket Nodefony.
            </p>
            <div className="badges">
              <span className="badge badge--accent">React v{reactVersion}</span>
              <span className="badge">Vite dev server</span>
              {data && <span className="badge">env : {data.env}</span>}
            </div>
          </div>

          <LiveSection />

          <section>
            <div className="sec-head">
              <p className="kicker">Par comparaison</p>
              <h2>Ce que la page fait quand elle DEMANDE</h2>
              <p>
                À gauche, une requête par seconde : c'est la page qui réclame. À
                droite, le rechargement à chaud, qui garde l'état du composant.
              </p>
            </div>
            <div className="grid">
              <div className="card">
                <h3>🔌 Requête HTTP</h3>
                <code className="route">GET /react/api/data — 1×/s</code>
                {error ? (
                  <pre className="out out--err">{error}</pre>
                ) : data ? (
                  <pre className="out">{JSON.stringify(data, null, 2)}</pre>
                ) : (
                  <p className="hint">chargement…</p>
                )}
              </div>

              <div className="card">
                <h3>♻️ Rechargement à chaud</h3>
                <button
                  className="counter"
                  onClick={() => setCount((c) => c + 1)}
                >
                  {count} clic{count > 1 ? "s" : ""}
                </button>
                <p className="hint">
                  Édite <code>frontend/src/App.tsx</code> : Vite recompile et le
                  compteur garde sa valeur.
                </p>
              </div>
            </div>
          </section>

          <p className="foot">
            La même page en <a href="/vue/app">Vue</a>,{" "}
            <a href="/angular/app">Angular</a> et{" "}
            <a href="/svelte/app">Svelte</a> — ou la{" "}
            <a href="/nodefony">console d'administration</a>.
          </p>
        </main>
      </div>
    </NodefonyProvider>
  );
}
