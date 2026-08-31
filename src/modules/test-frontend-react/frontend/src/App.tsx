import { useEffect, useState, version as reactVersion } from "react";
// Les hooks `nodefony/react` sont de MINCES enveloppes sur le socle agnostique
// de `nodefony/client` — le même que consomment les vitrines Vue, Angular et
// Svelte. Deux concepts, ici comme là-bas : un fournisseur qui reçoit
// l'adresse, et un abonnement.
import {
  installErrorCapture,
  installRequestIdProvider,
  installSyslogUplink,
  observeSnapshot,
  Syslog,
  withRequestId,
  type SocketSnapshot,
} from "nodefony/client";
import {
  NodefonyProvider,
  useNodefony,
  useNodefonyChannel,
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

/**
 * Combien de rechargements À CHAUD depuis le dernier chargement complet.
 *
 * `import.meta.hot.data` est la mémoire que Vite fait survivre au remplacement
 * d'un module — et à lui seul. Le module étant ré-exécuté à chaque mise à jour,
 * il suffit de compter ses exécutions : un chargement complet repart de zéro,
 * une mise à jour à chaud incrémente. Aucun écouteur à poser, donc aucun à
 * retirer.
 *
 * Sans ce chiffre, la carte échouait EN SILENCE : si Vite tombait en
 * rechargement complet, le compteur de clics repartait à zéro et personne ne
 * pouvait dire si la démonstration avait marché ou raté.
 */
/**
 * La barre de debug s'auto-injecte en développement et expose ce handle — c'est
 * la même poignée que la console d'administration emploie. On ne la remonte pas,
 * on la pilote : `DebugBarHandle` (cf `nodefony/debugbar`).
 */
type Debugbar = { isVisible(): boolean; toggle(): void } | undefined;
const debugbar = (): Debugbar =>
  (globalThis as { __NODEFONY_DEBUGBAR__?: Debugbar }).__NODEFONY_DEBUGBAR__;

const hot = (import.meta as { hot?: { data: Record<string, unknown> } }).hot;
if (hot) hot.data.majs = ((hot.data.majs as number) ?? 0) + 1;
const MAJS_A_CHAUD = hot ? ((hot.data.majs as number) ?? 1) - 1 : 0;

/** Les quatre vitrines, pour les comparer d'un clic. */
const FRONTS = [
  { nom: "React", href: "/react/app" },
  { nom: "Vue", href: "/vue/app" },
  { nom: "Angular", href: "/angular/app" },
  { nom: "Svelte", href: "/svelte/app" },
];

/** La dernière trame, dite pour un humain — « — » tant qu'il n'y en a aucune. */
const derniereDe = (v: SocketSnapshot | null): string =>
  v?.lastFrame.at
    ? `${v.lastFrame.method ?? "?"} à ${new Date(v.lastFrame.at).toLocaleTimeString()}`
    : "—";

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
/**
 * **Les incidents de CETTE page remontent au serveur** — la démonstration.
 *
 * Trois appels suffisent, et c'est tout l'objet de cette section : une
 * application ordinaire branche l'observabilité de son navigateur sans écrire de
 * plomberie. Ce que le serveur reçoit rejoint son propre journal, à côté de la
 * ligne de la requête qui a provoqué l'incident.
 *
 * Deux choses valent d'être dites parce qu'elles surprennent :
 *
 * 1. **Il faut une session.** Le canal montant n'accepte que les connexions
 *    authentifiées — un journal d'exploitation ouvert en écriture anonyme se
 *    noie et se falsifie. Cette vitrine partage son origine avec la console
 *    d'administration : s'y connecter dans le même navigateur suffit, il n'y a
 *    pas de second formulaire à remplir.
 * 2. **Le `requestId` n'est connu que dans la portée d'une réponse.** Un
 *    navigateur n'a pas de stockage de contexte comme le serveur ; « le
 *    requestId de la requête précédente » serait faux dès deux appels
 *    concurrents. `withRequestId` le rend explicite : ce qui est journalisé
 *    DEDANS porte la corrélation, ce qui est journalisé dehors porte l'identifiant
 *    de page.
 */
function IncidentsSection() {
  const live = useNodefony();
  const state = useNodefonyState();
  const [journal] = useState(() => new Syslog({ moduleName: "vitrine-react" }));
  const [dit, setDit] = useState<string | null>(null);

  useEffect(() => {
    // 1 · d'où vient le `requestId` quand il est su.
    installRequestIdProvider();
    // 2 · les erreurs que personne ne rattrape rejoignent ce journal.
    const stopCapture = installErrorCapture({ syslog: journal });
    // 3 · ce journal remonte au serveur par la socket déjà ouverte.
    const stopUplink = installSyslogUplink({
      syslog: journal,
      publisher: live,
    });
    return () => {
      stopUplink?.();
      stopCapture?.();
    };
  }, [journal, live]);

  /**
   * Provoque une erreur DANS le traitement d'une réponse — le chemin où le
   * `requestId` est réellement connu, et le seul qui prouve la corrélation de
   * bout en bout.
   */
  const provoquer = async () => {
    const reponse = await fetch(`/${FRONT.toLowerCase()}/api/data`);
    const requestId = reponse.headers.get("x-request-id") ?? undefined;
    const json = (await reponse.json()) as { result?: Record<string, unknown> };
    withRequestId(requestId, () => {
      try {
        // Une faute ordinaire : on lit un champ d'un objet qui n'existe pas.
        const absent = (json.result as { absent?: { valeur: string } }).absent;
        setDit(absent!.valeur);
      } catch (e) {
        journal.log(
          e instanceof Error ? e.message : String(e),
          3,
          "VITRINE",
          "clic sur « provoquer un incident »",
        );
        setDit(
          requestId
            ? `Incident journalisé et poussé au serveur, corrélé à la requête ${requestId.slice(0, 8)}…`
            : "Incident journalisé et poussé au serveur (aucun requestId sur cette réponse).",
        );
      }
    });
  };

  return (
    <section>
      <div className="sec-head">
        <p className="kicker">Observabilité</p>
        <h2>Ce qui casse ici se lit là-bas</h2>
        <p>
          Une erreur survenue dans ce navigateur rejoint le journal du serveur,
          à côté de la ligne de la requête qui l'a provoquée. Trois appels dans
          l'application, rien de plus.
        </p>
      </div>
      <p>
        <button type="button" onClick={() => void provoquer()}>
          Provoquer un incident
        </button>
      </p>
      {dit ? <p role="status">{dit}</p> : null}
      <p>
        <small>
          La remontée exige une session : le canal n'accepte pas les connexions
          anonymes. Connectez-vous à la console d'administration dans ce même
          navigateur, puis rechargez — l'entrée apparaîtra dans{" "}
          <code>/nodefony/logs</code>. Socket : {state}.
        </small>
      </p>
      <pre>
        <code>{`installRequestIdProvider()
installErrorCapture({ syslog })
installSyslogUplink({ syslog, publisher: socket })`}</code>
      </pre>
    </section>
  );
}

function LiveSection() {
  const live = useNodefony();
  const state = useNodefonyState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [texte, setTexte] = useState("");
  const [parHttp, setParHttp] = useState<string | null>(null);
  const [parSocket, setParSocket] = useState<string | null>(null);
  // Ce que le client sait de sa PROPRE socket — un seul contrat, partagé avec la
  // sonde de la barre et avec les trois autres vitrines.
  const [vue, setVue] = useState<SocketSnapshot | null>(null);
  useEffect(() => observeSnapshot(live, setVue), [live]);

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
          {vue?.lastFrame.at
            ? `dernière trame : ${derniereDe(vue)}`
            : "aucune trame — le serveur se tait tant qu'il n'a rien à dire"}
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

/**
 * Les outils de la barre : la sonde de socket et la bascule de la barre de debug.
 *
 * La sonde joue ici le rôle qu'elle tient dans la console d'administration —
 * savoir en permanence, sans quitter l'écran, si le temps réel est vivant et
 * combien il a livré. Elle ne coûte que deux appels au socle, les mêmes dans
 * les quatre vitrines : c'est précisément ce que l'extraction achète.
 */
function OutilsBarre() {
  const live = useNodefony();
  const state = useNodefonyState();
  const [vue, setVue] = useState<SocketSnapshot | null>(null);
  const [barreVisible, setBarreVisible] = useState(
    () => debugbar()?.isVisible() ?? false,
  );

  // UN instantané, pas cinq lectures à la main : `observeSnapshot` le rafraîchit
  // sur l'échantillonneur DÉJÀ en place (aucune horloge de plus, aucune trame).
  useEffect(() => observeSnapshot(live, setVue), [live]);

  const connecte = state === "connected";
  const attente = state === "connecting" || state === "reconnecting";
  return (
    <div className="outils">
      <span className="sonde-hote" tabIndex={0}>
        <span className="sonde">
          <span
            className={
              connecte ? "dot dot--on" : attente ? "dot dot--wait" : "dot"
            }
          />
          {ETATS[state] ?? state}
          <b>{vue?.frames ?? 0}</b> trames
        </span>
        <div className="sonde-detail" role="status">
          <dl>
            <dt>Adresse</dt>
            <dd>{vue?.url ?? "—"}</dd>
            <dt>État</dt>
            <dd>{ETATS[state] ?? state}</dd>
            <dt>Canaux</dt>
            <dd>{vue?.channels.join(", ") || "aucun"}</dd>
            <dt>Trames reçues</dt>
            <dd>{vue?.frames ?? 0}</dd>
            <dt>Dernière</dt>
            <dd>{derniereDe(vue)}</dd>
          </dl>
          <p className="rien">
            Tout cela vient du client lui-même : afficher ce panneau ne provoque
            aucune trame.
          </p>
        </div>
      </span>
      <button
        className="bascule"
        aria-pressed={barreVisible}
        onClick={() => {
          debugbar()?.toggle();
          setBarreVisible(debugbar()?.isVisible() ?? false);
        }}
      >
        Barre de debug
      </button>
    </div>
  );
}

/**
 * La carte du RECHARGEMENT À CHAUD — et, au passage, la façon la plus courte de
 * voir le fan-out : un clic ici s'affiche dans le salon de TOUS les onglets
 * ouverts, sans rien avoir à taper.
 */
function HmrCard() {
  const live = useNodefony();
  const [count, setCount] = useState(0);

  const cliquer = () => {
    const n = count + 1;
    setCount(n);
    // Le clic voyage : les autres vitrines l'apprennent par le serveur.
    live.emit("live:dire", { texte: `clic n°${n}`, front: FRONT });
  };

  return (
    <div className="card">
      <h3>♻️ Rechargement à chaud</h3>
      <button className="counter" onClick={cliquer}>
        {count} clic{count > 1 ? "s" : ""}
      </button>
      <p className="hint">
        {MAJS_A_CHAUD} rechargement{MAJS_A_CHAUD > 1 ? "s" : ""} à chaud depuis
        le dernier chargement complet — l'état ci-dessus y a survécu.
      </p>
      <p className="hint">
        Édite <code>frontend/src/App.tsx</code> : Vite recompile, le compteur ne
        repart PAS à zéro. S'il y retombe, c'est un rechargement complet, pas un
        rechargement à chaud.
      </p>
    </div>
  );
}

export function App() {
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
          <OutilsBarre />
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
          <IncidentsSection />

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

              <HmrCard />
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
