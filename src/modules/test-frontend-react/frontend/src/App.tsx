import { useEffect, useState, version as reactVersion } from "react";
// Les hooks `nodefony/react` sont de MINCES enveloppes sur le socle agnostique
// de `nodefony/client` — le même que consomment les vitrines Vue, Angular et
// Svelte. Deux concepts, ici comme là-bas : un fournisseur qui reçoit
// l'adresse, et un abonnement.
import {
  describeSocket,
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
  useNodefonySse,
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
  text: string;
  front: string;
  ts: number;
  pid: number;
}

/** Une ligne du journal du serveur, telle que le flux SSE la pousse. */
interface LogLine {
  id: number;
  time: number;
  severity: string;
  msgid: string;
  text: string;
  requestId?: string | undefined;
  dropped?: number | undefined;
}

/**
 * Le flux SSE du journal du serveur — sous `/nodefony/<ns>/api/`, donc dans la
 * zone d'administration : une session de la console est exigée.
 */
const JOURNAL = "/nodefony/test/api/syslog";

/** Lit une ligne poussée par le serveur ; tout ce qui n'en a pas la forme est ignoré. */
function lineOf(data: string): LogLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r: Record<string, unknown> = { ...raw };
  if (typeof r.id !== "number" || typeof r.text !== "string") return null;
  return {
    id: r.id,
    time: typeof r.time === "number" ? r.time : Date.now(),
    severity: typeof r.severity === "string" ? r.severity : "INFO",
    msgid: typeof r.msgid === "string" ? r.msgid : "",
    text: r.text,
    requestId: typeof r.requestId === "string" ? r.requestId : undefined,
    dropped: typeof r.dropped === "number" ? r.dropped : undefined,
  };
}

/** L'état d'un flux, dit pour un humain — `readyState` et `error` du socle. */
function fluxLabel(listening: boolean, readyState: number, error: boolean) {
  if (!listening) return { text: "écoute arrêtée", dot: "dot" };
  if (readyState === 1) return { text: "à l'écoute", dot: "dot dot--on" };
  if (readyState === 0)
    return {
      text: error ? "reconnexion automatique…" : "connexion…",
      dot: "dot dot--wait",
    };
  return { text: error ? "refusé par le serveur" : "fermé", dot: "dot" };
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
// Compteur conservé entre deux rechargements : absent au premier.
if (hot) hot.data.majs = ((hot.data.majs as number | undefined) ?? 0) + 1;
const MAJS_A_CHAUD = hot ? ((hot.data.majs as number | undefined) ?? 1) - 1 : 0;

/** Les quatre vitrines, pour les comparer d'un clic. */
const FRONTS = [
  { name: "React", href: "/react/app" },
  { name: "Vue", href: "/vue/app" },
  { name: "Angular", href: "/angular/app" },
  { name: "Svelte", href: "/svelte/app" },
];

/** La dernière trame, dite pour un humain — « — » tant qu'il n'y en a aucune. */
const lastFrom = (v: SocketSnapshot | null): string =>
  v?.lastFrame.at
    ? `${v.lastFrame.method ?? "?"} à ${new Date(v.lastFrame.at).toLocaleTimeString()}`
    : "—";

/** L'état de la connexion, dit en français — un écran ne parle pas machine. */
const STATES: Record<string, string> = {
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
  const [said, setSaid] = useState<string | null>(null);

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
      stopUplink();
      stopCapture();
    };
  }, [journal, live]);

  /**
   * Provoque une erreur DANS le traitement d'une réponse — le chemin où le
   * `requestId` est réellement connu, et le seul qui prouve la corrélation de
   * bout en bout.
   */
  const triggerIncident = async () => {
    const response = await fetch(`/${FRONT.toLowerCase()}/api/data`);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    withRequestId(requestId, () => {
      try {
        // Une faute ordinaire : on lit un champ que la réponse ne porte pas.
        const expected: { absent?: { value: string } } = {};
        // Faute VOULUE : la vitrine montre une TypeError remontée au journal ;
        // un `?.` la ferait disparaître.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        setSaid(expected.absent!.value);
      } catch (e) {
        journal.log(
          e instanceof Error ? e.message : String(e),
          3,
          "VITRINE",
          "clic sur « provoquer un incident »",
        );
        setSaid(
          requestId
            ? `Incident journalisé et poussé au serveur, corrélé à la requête ${requestId.slice(0, 8)}…`
            : "Incident journalisé et poussé au serveur (aucun requestId sur cette réponse).",
        );
      }
    });
  };

  return (
    <section id="observabilite">
      <div className="sec-head">
        <p className="kicker">Observabilité</p>
        <h2>Ce qui casse ici se lit là-bas</h2>
        <p>
          Une erreur survenue dans ce navigateur rejoint le journal du serveur,
          à côté de la ligne de la requête qui l'a provoquée. Trois appels dans
          l'application, rien de plus.
        </p>
      </div>
      <div className="grid">
        <div className="card">
          <h3>💥 Provoquer un incident</h3>
          <p className="hint">
            Le clic lit un champ absent d'une réponse : une TypeError,
            journalisée avec le requestId de cette requête, puis poussée au
            serveur par la socket.
          </p>
          <button className="counter" onClick={() => void triggerIncident()}>
            Provoquer un incident
          </button>
          {said ? (
            <p className="hint" role="status">
              {said}
            </p>
          ) : null}
          <p className="hint">
            La remontée exige une session : le canal n'accepte pas les
            connexions anonymes. Connectez-vous à la console d'administration
            dans ce navigateur, puis rechargez — l'entrée apparaît dans le
            journal en direct ci-dessus (VITRINE), avec le même requestId.
            Socket : {STATES[state] ?? state}.
          </p>
        </div>
        <div className="card">
          <h3>🧩 Trois appels</h3>
          <pre className="code">
            <code>{`installRequestIdProvider()
installErrorCapture({ syslog })
installSyslogUplink({ syslog, publisher: socket })`}</code>
          </pre>
          <p className="hint">
            Les erreurs que personne ne rattrape y passent aussi : la capture
            est posée pour toute la page, et retirée au démontage.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Le JOURNAL du serveur, en direct, par un flux SSE — le pendant de la socket :
 * le serveur parle, la page écoute, sur une réponse HTTP ordinaire.
 *
 * Tout tient dans un appel : `useNodefonySse` ouvre le flux au montage et le
 * FERME au démontage. Une adresse `null` suspend l'écoute sans démonter. Coupé
 * par le réseau, le client se reconnecte seul en renvoyant `Last-Event-ID` —
 * le serveur ne rejoue que ce qui manque.
 */
function SseSection() {
  const [listening, setListening] = useState(true);
  const [lines, setLines] = useState<LogLine[]>([]);
  const flux = useNodefonySse(listening ? JOURNAL : null, {
    events: ["log"],
    onEvent: (e) => {
      const line = lineOf(e.data);
      if (!line) return;
      // Une reprise rejoue la fin du tampon : on n'ajoute que le neuf.
      setLines((l) => {
        const last = l.at(-1);
        return last && line.id <= last.id ? l : [...l, line].slice(-12);
      });
    },
  });
  const streamStatus = fluxLabel(listening, flux.readyState, flux.error);
  const refused = listening && flux.readyState === 2 && flux.error;

  return (
    <section id="journal">
      <div className="sec-head">
        <p className="kicker">Flux SSE</p>
        <h2>Journal du serveur en direct</h2>
        <p>
          Le serveur parle, la page écoute — sur une réponse HTTP ordinaire qui
          ne se termine pas. Chaque ligne porte un identifiant : coupé puis
          rétabli, le flux reprend là où il s'était arrêté.
        </p>
      </div>

      <div className="bandeau">
        <p className="live-state">
          <span className={streamStatus.dot} />
          {streamStatus.text}
        </p>
        <p className="live-meta">
          {lines.length} ligne{lines.length > 1 ? "s" : ""} — les douze
          dernières
        </p>
        <button
          className="btn btn--ghost"
          onClick={() => setListening((v) => !v)}
        >
          {listening ? "Arrêter l'écoute" : "Écouter"}
        </button>
      </div>

      {refused ? (
        <p className="refus" role="status">
          Le serveur a refusé le flux : le journal d'exploitation est réservé à
          l'administration.{" "}
          <a href="/nodefony/login">Connectez-vous à la console</a> dans ce
          navigateur, puis revenez ici.
        </p>
      ) : null}

      <ol className="journal">
        {lines.length === 0 ? (
          <li className="vide">Rien encore — le serveur n'a rien dit.</li>
        ) : (
          lines.map((l) => (
            <li key={l.id}>
              <time>{new Date(l.time).toLocaleTimeString()}</time>
              <span className={`sev sev--${l.severity.toLowerCase()}`}>
                {l.severity}
              </span>
              <span className="msgid">{l.msgid}</span>
              <span className="txt">
                {l.text}
                {l.dropped ? ` (+${l.dropped} perdues)` : ""}
              </span>
              {l.requestId ? (
                <code className="rid">{l.requestId.slice(0, 8)}</code>
              ) : null}
            </li>
          ))
        )}
      </ol>

      <div className="grid" style={{ marginTop: "16px" }}>
        <div className="card">
          <h3>📡 WebSocket ou SSE ?</h3>
          <table className="versus">
            <thead>
              <tr>
                <th scope="col">Critère</th>
                <th scope="col">WebSocket</th>
                <th scope="col">SSE</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Sens</th>
                <td>les deux</td>
                <td>serveur → page</td>
              </tr>
              <tr>
                <th scope="row">Transport</th>
                <td>protocole à part</td>
                <td>réponse HTTP ordinaire</td>
              </tr>
              <tr>
                <th scope="row">Reprise</th>
                <td>rejoue les abonnements</td>
                <td>Last-Event-ID, rien de perdu</td>
              </tr>
              <tr>
                <th scope="row">Ici</th>
                <td>le salon, le pont d'API</td>
                <td>le journal du serveur</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>🧩 Un appel, fermé tout seul</h3>
          <pre className="code">
            <code>{`const flux = useNodefonySse(JOURNAL, {
  events: ["log"],
  onEvent: (e) => …,
})`}</code>
          </pre>
          <p className="hint">
            Démonter le composant ferme le flux : aucune requête ne reste
            ouverte derrière une page quittée. Les mêmes trois lignes en Vue,
            Angular et Svelte.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Ce que le client sait de SA socket — la vignette du tableau que la console
 * du navigateur affiche, ligne pour ligne : `describeSocket` est la source
 * unique des deux, valeurs ET explications.
 */
function ClientSection() {
  const live = useNodefony();
  const [vue, setVue] = useState<SocketSnapshot | null>(null);
  useEffect(() => observeSnapshot(live, setVue), [live]);
  const rows = vue ? describeSocket(vue) : [];

  return (
    <section id="client">
      <div className="sec-head">
        <p className="kicker">Diagnostic</p>
        <h2>Le client vu de l'intérieur</h2>
        <p>
          Ce que la socket sait d'elle-même, sans rien demander au serveur. Le
          même tableau s'affiche dans la console du navigateur ; ici, chaque
          ligne dit ce qu'elle garantit.
        </p>
      </div>
      <div className="card">
        <dl className="fiche">
          {rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>
                <span className="val">{r.value}</span>
                <span className="pourquoi">{r.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          Dans la console (F12) : le badge <code>◆ nodefony client</code>, son
          groupe replié, puis <code>nodefony.socket</code>,{" "}
          <code>nodefony.sockets()</code> et <code>nodefony.identity()</code>.
          En production, rien de tout cela n'est posé.
        </p>
      </div>
    </section>
  );
}

function LiveSection() {
  const live = useNodefony();
  const state = useNodefonyState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
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

  const connected = state === "connected";
  const pending = state === "connecting" || state === "reconnecting";

  const send = () => {
    const said = text.trim();
    if (!said) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    live.emit("live:say", { text: said, front: FRONT });
    setText("");
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
    <section id="temps-reel">
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
              connected ? "dot dot--on" : pending ? "dot dot--wait" : "dot"
            }
          />
          {STATES[state] ?? state}
        </p>
        <p className="live-meta">
          {vue?.lastFrame.at
            ? `dernière trame : ${lastFrom(vue)}`
            : "aucune trame — le serveur se tait tant qu'il n'a rien à dire"}
        </p>
        <button
          className="btn btn--ghost"
          onClick={() => (connected ? live.disconnect() : void live.connect())}
        >
          {connected ? "Couper la connexion" : "Rétablir"}
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
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Écrivez, puis Entrée…"
              aria-label="Message à diffuser"
            />
            <button className="counter" onClick={send}>
              Envoyer
            </button>
          </div>
          <ul className="salon">
            {messages.length === 0 ? (
              <li className="vide">Rien encore — écrivez quelque chose.</li>
            ) : (
              messages.map((m, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- anneau borné sans identifiant côté serveur : l'horodatage seul se répète, le rang le départage ; lignes sans état
                <li key={`${m.ts}-${i}`}>
                  <span className="qui">{m.front}</span>
                  <span>{m.text}</span>
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
          <button
            className="counter"
            onClick={() => {
              comparer().catch((e: unknown) => {
                setParHttp(
                  `Erreur : ${e instanceof Error ? e.message : String(e)}`,
                );
              });
            }}
          >
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
function ToolsBar() {
  const live = useNodefony();
  const state = useNodefonyState();
  const [vue, setVue] = useState<SocketSnapshot | null>(null);
  const [barVisible, setBarVisible] = useState(
    () => debugbar()?.isVisible() ?? false,
  );

  // UN instantané, pas cinq lectures à la main : `observeSnapshot` le rafraîchit
  // sur l'échantillonneur DÉJÀ en place (aucune horloge de plus, aucune trame).
  useEffect(() => observeSnapshot(live, setVue), [live]);

  const connected = state === "connected";
  const pending = state === "connecting" || state === "reconnecting";
  return (
    <div className="outils">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- hôte d'une fiche CSS (:focus-within) : sans arrêt de tabulation, le détail ne s'ouvrirait qu'au survol */}
      <span className="sonde-hote" tabIndex={0}>
        <span className="sonde">
          <span
            className={
              connected ? "dot dot--on" : pending ? "dot dot--wait" : "dot"
            }
          />
          {STATES[state] ?? state}
          <b>{vue?.frames ?? 0}</b> trames
        </span>
        <div className="sonde-detail" role="status">
          <dl>
            <dt>Adresse</dt>
            <dd>{vue?.url ?? "—"}</dd>
            <dt>État</dt>
            <dd>{STATES[state] ?? state}</dd>
            <dt>Canaux</dt>
            <dd>{vue?.channels.join(", ") || "aucun"}</dd>
            <dt>Trames reçues</dt>
            <dd>{vue?.frames ?? 0}</dd>
            <dt>Dernière</dt>
            <dd>{lastFrom(vue)}</dd>
          </dl>
          <p className="rien">
            Tout cela vient du client lui-même : afficher ce panneau ne provoque
            aucune trame.
          </p>
        </div>
      </span>
      <button
        className="bascule"
        aria-pressed={barVisible}
        onClick={() => {
          debugbar()?.toggle();
          setBarVisible(debugbar()?.isVisible() ?? false);
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
    live.emit("live:say", { text: `clic n°${n}`, front: FRONT });
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
          setData(json.result ?? json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    // `poll` capture ses propres erreurs (état `error`) : aucune promesse ne rejette.
    void poll();
    const id = setInterval(() => void poll(), 1000);
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
                aria-current={f.name === "React" ? "page" : undefined}
              >
                {f.name}
              </a>
            ))}
          </nav>
          <ToolsBar />
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
            <nav className="sommaire" aria-label="Sur cette page">
              <a href="#temps-reel">Temps réel</a>
              <a href="#comparaison">Par comparaison</a>
              <a href="#journal">Journal SSE</a>
              <a href="#client">Le client</a>
              <a href="#observabilite">Observabilité</a>
            </nav>
          </div>

          <LiveSection />
          <section id="comparaison">
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

          <SseSection />
          <ClientSection />
          <IncidentsSection />

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
