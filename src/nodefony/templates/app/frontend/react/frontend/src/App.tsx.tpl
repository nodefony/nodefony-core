import { useEffect, <% if (!it.complete) { %>useRef, <% } %>useState, version as reactVersion } from "react";
<% if (it.complete) { %>// FAÇADE temps réel isomorphe du framework — aucun `new WebSocket` à la main
// (reconnexion, re-subscribe, état : gérés). Deux concepts suffisent : le
// Provider, qui reçoit l'adresse du serveur, et un hook par besoin.
// Subpath `nodefony/react` : une porte EXPLICITE, résolue à l'identique par
// Vite, Node et le typecheck (la racine `nodefony` dépend d'une condition
// d'export que `tsgo --noEmit` ne voit pas).
import {
  NodefonyProvider,
  useNodefony,
  useNodefonyState,
  useNodefonyChannelData,
  useNodefonyLogin,
  type NodefonyLoginState,
  type NodefonyLoginError,
  type LoginErrorKind,
} from "nodefony/react";
<% } %>import { NODEFONY_LOGO } from "./brand";
// Mise en page et palette de la démonstration — feuille PARTAGÉE par les trois
// vitrines (Vite l'injecte dans le document, elle est donc bien globale).
import "./showcase.css";
import "./accent.css";

interface ApiData {
  hello: string;
  pid: number;
  /** Identité résolue par la zone firewall `main` (^/api) — « anonyme » sinon. */
  who?: string;
}
<% if (it.complete) { %>
/** Réponse de la route PROTÉGÉE /api/secure/hello (zone `secure`, 401 sans session). */
interface SecureData {
  message: string;
  zone: string;
  pid: number;
}

<% } %>/**
 * Page d'accueil de l'app — vitrine AUTONOME (zéro dépendance UI) :
 *  - panneau de marque (même design que le login de Studio : dégradé, glow,
 *    logo, slogan, 3 piliers du framework) ;
 *  - trois preuves INTERACTIVES : fetch HTTP, echo WebSocket live sur le MÊME
 *    controller (le différenciateur Nodefony), état React préservé par HMR.
 * Édite ce fichier : la page se met à jour sans recharger ni perdre le compteur.
 */

const FEATURES = [
  {
    title: "Temps réel natif",
    desc: "HTTP et WebSocket, co-citoyens dans le même contexte.",
    // éclair (bolt)
    icon: <path d="M13 2 4.5 12.5H11L9.5 22 18 11.5h-6.5L13 2z" />,
  },
  {
    title: "Observabilité totale",
    desc: "Métriques, logs et traces — en direct.",
    // pulse (activity)
    icon: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" fill="none" strokeWidth="2" />,
  },
  {
    title: "Zero Trust",
    desc: "Sécurité par défaut, vos données protégées.",
    // bouclier
    icon: <path d="M12 2 5 5v6c0 5 3.5 8.5 7 11 3.5-2.5 7-6 7-11V5l-7-3z" />,
  },
];

<% if (it.complete) { %>/** Un message du canal `live:events` (cf `nodefony/controllers/LiveController.ts`). */
interface LiveEvent {
  text: string;
  ts: number;
  pid: number;
}

/**
 * Carte temps réel — consomme la FAÇADE (hooks `nodefony/react`) : abonnement
 * au montage, désabonnement au démontage, re-subscribe à la reconnexion, état
 * de connexion — tout est porté par le client. Zéro `WebSocket` à la main.
 */
function LiveCard() {
  // La socket du Provider — même instance que celle des hooks ci-dessous.
  const live = useNodefony();
  const state = useNodefonyState();
  const last = useNodefonyChannelData<LiveEvent>("live:events");
  const [pong, setPong] = useState<string | null>(null);
  // Un gestionnaire de clic ne rend rien à React : la promesse qu'il lance
  // doit donc porter SES erreurs, sinon un échec devient un rejet non géré.
  const ping = async () => {
    const t0 = performance.now();
    try {
      await live.request("live:ping", {});
      setPong(`pong en ${Math.round(performance.now() - t0)} ms`);
    } catch (e: unknown) {
      setPong(`échec : ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Ce que CETTE page envoie, TOUTES les pages abonnées le reçoivent : ouvrir
  // un second onglet et cliquer suffit à le voir. C'est ce partage qui fait
  // l'intérêt d'une socket — pas un battement qui parlerait pour ne rien dire.
  const say = () =>
    live.emit("live:say", {
      text: `bonjour de la page (${Date.now() % 1000})`,
    });
  return (
    <div className="nf-card">
      <h2>3. Temps réel — la socket Nodefony</h2>
      <p className="nf-dim">
        <code>LiveController</code> (<code>--kind realtime</code>) publie le
        canal <code>live:events</code> quand il se passe quelque chose — jamais
        sur une horloge ; la page le consomme par les hooks{" "}
        <code>nodefony/react</code>. Ouvrez un second onglet pour voir arriver
        ce que celui-ci envoie.
      </p>
      <p>
        état : <strong>{state}</strong>
        {last && (
          <>
            {" "}
            · reçu <strong>{last.text}</strong> (pid {last.pid})
          </>
        )}
      </p>
      <button onClick={() => void ping()}>RPC live:ping</button>{" "}
      <button onClick={say}>envoyer sur le canal</button>
      {pong && <span className="nf-dim"> {pong}</span>}
    </div>
  );
}

/** Le texte de chaque sorte d'échec — une entrée par sorte, exigée par le type. */
const LOGIN_ERRORS: Record<
  LoginErrorKind,
  (error: NodefonyLoginError) => string
> = {
  credentials: (e) => e.message || "identifiants invalides",
  throttled: (e) =>
    `trop d'essais — réessaie dans ${Math.max(1, Math.ceil(((e.retryAt ?? 0) - Date.now()) / 1000))} s`,
  network: () => "serveur injoignable",
  server: (e) => `échec : ${e.message || String(e.status)}`,
  cancelled: () => "passkey annulée",
  unsupported: () => "passkey non prise en charge par ce navigateur",
};

/**
 * Ce que l'écran dit du déroulé de connexion. Les RÈGLES (étapes, second
 * facteur, blocage, fournisseurs) vivent dans le framework ; le TEXTE est à
 * l'application. Un refus d'identifiants relaie le message uniforme du
 * serveur : le préciser dirait à un inconnu si le compte existe.
 */
function loginMessage(login: NodefonyLoginState): string | null {
  const error = login.error;
  if (error === null) {
    return login.step === "authenticated" && login.user
      ? `session ouverte — ${login.user.username}`
      : null;
  }
  return LOGIN_ERRORS[error.kind](error);
}

<% } %>export function App() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
<% if (!it.complete) { %>  const [wsInput, setWsInput] = useState("ping");
  const [wsLog, setWsLog] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);
<% } %>
<% if (it.complete) { %>  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("nodefony-dev-42");
  const [mfaCode, setMfaCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Le déroulé de connexion du FRAMEWORK : étapes, second facteur (TOTP),
  // blocage après trop d'essais, fournisseurs (Keycloak…), passkey. Aucun
  // `fetch` vers les routes de session n'est écrit à la main.
  const { state: login, flow } = useNodefonyLogin();
  const [secureData, setSecureData] = useState<SecureData | null>(null);
<% } %>
  // Rappelé après login/logout : la zone firewall `main` (^/api) résout
  // l'identité par requête → `who` change sans recharger la page.
  // Ne rejette jamais : l'erreur finit à l'écran, ce qui permet de l'appeler
  // sans l'attendre (`void refreshHello()`).
  const refreshHello = async (): Promise<void> => {
    try {
      const r = await fetch("/api/hello");
      const j = (await r.json()) as { result?: ApiData };
      const d = j.result ?? (j as ApiData); // Nodefony wrappe `{ result }`
      setData(d);
<% if (it.complete) { %>      // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
      // ^/api/secure : sans session le firewall répond 401 avant le controller).
      if (d.who && d.who !== "anonyme") {
        try {
          const s = await fetch("/api/secure/hello", {
            credentials: "same-origin",
          });
          const sj = s.ok
            ? ((await s.json()) as { result?: SecureData })
            : null;
          setSecureData(sj ? (sj.result ?? (sj as SecureData)) : null);
        } catch {
          setSecureData(null);
        }
      } else {
        setSecureData(null);
      }
<% } %>    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
<% if (it.complete) { %>
  // Session BFF du framework (cookie opaque HttpOnly — le front ne voit
  // jamais de token) : le même déroulé que la console /nodefony.
  const afterLogin = async (next: NodefonyLoginState) => {
    if (next.step !== "authenticated") return;
    setMfaCode("");
    setNotice(null);
    await refreshHello();
  };
  const doLogin = async () => afterLogin(await flow.login(username, password));
  const doMfa = async () => afterLogin(await flow.submitMfaCode(mfaCode));
  const doPasskey = async () => afterLogin(await flow.loginWithPasskey());

  const doLogout = async () => {
    // Une session ouverte chez un fournisseur (Keycloak…) se ferme AUSSI chez
    // lui : le serveur rend son adresse de déconnexion, qu'il faut suivre.
    const providerLogout = await flow.logout();
    if (providerLogout !== null) {
      location.assign(providerLogout);
      return;
    }
    setNotice("session fermée");
    await refreshHello();
  };
<% } %>
  useEffect(() => {
    void refreshHello();
<% if (it.complete) { %>    // Les boutons des fournisseurs (Keycloak, Google…) : c'est le serveur qui
    // dit lesquels sont configurés.
    void flow.loadProviders();
<% } else { %>
    // WS même origine que la page (ws en http, wss en https).
    // ⚠ Echo BRUT = démo du pipeline HTTP/WS partagé, pas un modèle : pour du
    // WS métier, génère la bonne couche (`nodefony create controller <nom>
    // --kind realtime`) et consomme-la par la FAÇADE client (`NodefonySocket`,
    // hooks `nodefony/react`) au lieu d'un `new WebSocket` à la main.
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
    socket.addEventListener("message", (ev) => {
      setWsLog((log) => [...log.slice(-4), `← ${String(ev.data)}`]);
    });
    socket.addEventListener("error", () =>
      setWsLog((log) => [...log, "⚠ connexion WS impossible"]),
    );
    ws.current = socket;
    return () => {
      // StrictMode (dev) monte/démonte l'effet 2× : fermer une socket encore
      // en CONNECTING lève un warning navigateur (« closed before the
      // connection is established ») — on attend l'open pour fermer proprement.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close());
      } else {
        socket.close();
      }
    };
<% } %>  }, []);
<% if (!it.complete) { %>
  const sendWs = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(wsInput);
      setWsLog((log) => [...log.slice(-4), `→ ${wsInput}`]);
    }
  };
<% } %>
  return (
    <div className="nf-split">
      {/* ── Panneau de marque (même design que le login Studio) ─────────── */}
      <aside className="nf-hero">
        <div className="nf-glow" aria-hidden />
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            position: "relative",
          }}
        >
          <img
            src={NODEFONY_LOGO}
            alt="Nodefony"
            height={42}
            draggable={false}
          />
          <span style={{ fontWeight: 700, fontSize: 26 }}><%= it.appName %></span>
        </div>

        <div style={{ maxWidth: 480, position: "relative" }}>
          <h2>Le temps réel, nativement.</h2>
          <p className="nf-sub">
            Observez, comprenez et contrôlez chaque sous-système de Nodefony —
            en direct.
          </p>
          {FEATURES.map((f) => (
            <div className="nf-feature" key={f.title}>
              <div className="nf-ficon">
                <svg viewBox="0 0 24 24">{f.icon}</svg>
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,.78)" }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            position: "relative",
          }}
        >
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.65)" }}>
            Nodefony 10 · licence Apache 2.0
          </span>
          <a
            href="https://github.com/nodefony/nodefony-core"
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}
          >
            GitHub
          </a>
        </div>
      </aside>

      {/* ── Preuves interactives — TON app tourne ────────────────────────── */}
      <main className="nf-main">
        <header className="nf-fwhead">
          {/* Logo officiel React — SVG inline (aucun asset externe). */}
          <svg
            className="nf-fwlogo"
            viewBox="-11.5 -10.23174 23 20.46348"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="React"
          >
            <circle cx="0" cy="0" r="2.05" fill="#61dafb" />
            <g stroke="#61dafb" strokeWidth="1" fill="none">
              <ellipse rx="11" ry="4.2" />
              <ellipse rx="11" ry="4.2" transform="rotate(60)" />
              <ellipse rx="11" ry="4.2" transform="rotate(120)" />
            </g>
          </svg>
          <div>
            <h1>Votre app est en ligne.</h1>
            <span className="nf-fwbadge">React v{reactVersion} · Vite HMR</span>
          </div>
<% if (it.complete) { %>          {/* Réponse de la route PROTÉGÉE — visible uniquement session ouverte. */}
          {secureData && (
            <span className="nf-hello">👋 {secureData.message}</span>
          )}
<% } %>        </header>
        <p className="nf-dim">
          <%= it.complete ? "Quatre" : "Trois" %> preuves interactives — édite <code>frontend/src/App.tsx</code>,
          la page se met à jour par HMR sans perdre le compteur.
        </p>

        <div className="nf-card">
<% if (it.complete) { %>          <h2>
            1. Backend HTTP —{" "}
            <code>GET {secureData ? "/api/secure/hello" : "/api/hello"}</code>
          </h2>
<% } else { %>          <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
<% } %>          {error ? (
            <pre style={{ color: "crimson" }}>{error}</pre>
          ) : data ? (
            <pre>{JSON.stringify(<%= it.complete ? "secureData ?? data" : "data" %>, null, 2)}</pre>
          ) : (
            <p>loading…</p>
          )}
        </div>
<% if (it.complete) { %>
        <div className="nf-card">
          <h2>
            2. Firewall — l'identité vit dans la zone <code>^/api</code>
          </h2>
          <p className="nf-dim">
            Deux zones dans <code>nodefony.config.ts</code> : <code>main</code>{" "}
            (<code>^/api</code>, session → anonymous, jamais bloquante) et{" "}
            <code>secure</code> (<code>^/api/secure</code>, session SEULE —
            pattern plus spécifique, il gagne le match ; sans session le
            firewall répond 401). Connecte-toi : le compte <code>admin</code> a
            pour mot de passe <code>nodefony-dev-42</code> en développement, et
            celui de <code>NF_ADMIN_PASSWORD</code> en production — où il est
            EXIGÉ, car une application ne naît jamais en ligne avec un secret
            connu. Alors la carte 1 bascule sur{" "}
            <code>GET /api/secure/hello</code> → « Bonjour admin ».
          </p>
          {data?.who && data.who !== "anonyme" ? (
            <>
              <span>
                connecté — <strong>{data.who}</strong>
              </span>{" "}
              <button onClick={() => void doLogout()}>Se déconnecter</button>
            </>
          ) : login.step === "mfa" ? (
            <>
              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doMfa();
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="code à usage unique"
                autoFocus
              />{" "}
              <button disabled={login.pending} onClick={() => void doMfa()}>
                Valider le code
              </button>{" "}
              <button onClick={() => flow.back()}>Annuler</button>
            </>
          ) : (
            <>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                aria-label="utilisateur"
              />{" "}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doLogin();
                }}
                autoComplete="current-password"
                aria-label="mot de passe"
              />{" "}
              <button disabled={login.pending} onClick={() => void doLogin()}>
                Se connecter
              </button>
              {login.passkeyAvailable && (
                <>
                  {" "}
                  <button
                    disabled={login.pending}
                    onClick={() => void doPasskey()}
                  >
                    Passkey
                  </button>
                </>
              )}
              {login.providers?.map((p) => (
                <span key={p.name}>
                  {" "}
                  <button onClick={() => flow.startProvider(p.name)}>
                    {p.label}
                  </button>
                </span>
              ))}
            </>
          )}
          {(loginMessage(login) ?? notice) && (
            <p className="nf-dim" role="status">
              {loginMessage(login) ?? notice}
            </p>
          )}
        </div>
<% } %>
<% if (it.complete) { %>        {/* Deux concepts pour du temps réel : ce Provider, et un hook dans la
            carte. Le Provider fabrique la socket partagée pour cette URL et la
            connecte — l'URL est RELATIVE, résolue contre la page (https → wss).
            Deux Providers de même URL n'ouvrent qu'UNE connexion. */}
        <NodefonyProvider url="/api/live/realtime">
          <LiveCard />
        </NodefonyProvider>
<% } else { %>        <div className="nf-card">
          <h2>2. WebSocket — MÊME controller que le HTTP</h2>
          <p className="nf-dim">
            <code>HelloController</code> porte la route GET <em>et</em> la route
            WEBSOCKET : un seul pipeline (firewall, audit, logs).
          </p>
          <input
            value={wsInput}
            onChange={(e) => setWsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendWs()}
            aria-label="message à envoyer"
          />{" "}
          <button onClick={sendWs}>Envoyer en WS</button>
          <pre>{wsLog.join("\n") || "(envoie un message)"}</pre>
        </div>
<% } %>
        <div className="nf-card">
          <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check — état React préservé</h2>
          <button onClick={() => setCount((c) => c + 1)}>
            count is {count}
          </button>
          <p className="nf-dim">
            Édite <code>frontend/src/App.tsx</code> — Vite recompile à la volée,
            la page se met à jour <em>sans recharger</em> et le compteur est
            conservé.
          </p>
        </div>

<% if (it.complete) { %>        <p className="nf-dim">
          Console d'administration : <a href="/nodefony">/nodefony</a> (Studio,
          en dev)
        </p>
<% } %>      </main>
    </div>
  );
}
