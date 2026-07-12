import { useEffect, useRef, useState, version as reactVersion } from "react";
import { NODEFONY_LOGO } from "./brand";

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
<% } %>

/**
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

const CSS = `
  :root { --nf-bg:#f7f9fc; --nf-fg:#1a1f26; --nf-card:#fff; --nf-border:#e2e8f0; --nf-dim:#5b6472; }
  @media (prefers-color-scheme: dark) {
    :root { --nf-bg:#12161c; --nf-fg:#e8ecf1; --nf-card:#1a2028; --nf-border:#2a3340; --nf-dim:#98a2b3; }
  }
  body { margin:0; }
  .nf-split { display:flex; min-height:100vh; font-family:system-ui, sans-serif;
              background:var(--nf-bg); color:var(--nf-fg); }
  .nf-hero { flex:1.05; position:relative; overflow:hidden; color:#fff;
             display:flex; flex-direction:column; justify-content:space-between;
             padding:48px; box-sizing:border-box;
             background:linear-gradient(140deg,#022c4e 0%,#004d8c 45%,#0067ba 100%); }
  .nf-glow { position:absolute; inset:0; pointer-events:none;
             background:radial-gradient(circle at 26% 16%, rgba(255,255,255,.16), transparent 46%),
                        radial-gradient(circle at 88% 92%, rgba(255,255,255,.08), transparent 42%); }
  .nf-hero h1 { font-size:clamp(30px,3.4vw,42px); font-weight:800; line-height:1.12; margin:0; }
  .nf-hero .nf-sub { font-size:18px; color:rgba(255,255,255,.82); margin:10px 0 0; }
  .nf-feature { display:flex; gap:14px; align-items:flex-start; margin-top:22px; }
  .nf-ficon { width:42px; height:42px; border-radius:10px; flex:none; display:grid; place-items:center;
              background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.18); }
  .nf-ficon svg { width:22px; height:22px; fill:#fff; stroke:#fff; }
  .nf-main { flex:1; padding:48px 40px; box-sizing:border-box; overflow-y:auto; }
  .nf-card { background:var(--nf-card); border:1px solid var(--nf-border); border-radius:10px;
             padding:20px; margin-bottom:18px; }
  .nf-card h2 { margin:0 0 10px; font-size:17px; }
  .nf-card pre { background:rgba(127,127,127,.08); padding:10px; border-radius:6px; overflow-x:auto; }
  .nf-card input { padding:7px 10px; border-radius:6px; border:1px solid var(--nf-border);
                   background:var(--nf-bg); color:var(--nf-fg); }
  .nf-card button { padding:7px 14px; border-radius:6px; border:none; cursor:pointer;
                    background:#0067ba; color:#fff; font-weight:600; }
  .nf-card button:hover { background:#0a79d6; }
  .nf-dim { color:var(--nf-dim); font-size:14px; }
  .nf-fwhead { display:flex; align-items:center; gap:16px; margin-bottom:8px; }
  .nf-fwhead h1 { margin:0; }
  .nf-fwlogo { width:52px; height:auto; flex:none;
               filter:drop-shadow(0 4px 12px rgba(97,218,251,.35));
               animation:nf-spin 16s linear infinite; }
  @keyframes nf-spin { to { transform:rotate(360deg); } }
  .nf-fwbadge { display:inline-block; margin-top:4px; padding:2px 10px; border-radius:999px;
                font-size:12.5px; font-weight:600; color:#149eca;
                background:rgba(97,218,251,.14); border:1px solid rgba(97,218,251,.35); }
  .nf-hello { margin-left:auto; padding:7px 16px; border-radius:999px; font-weight:700;
              font-size:15px; color:#2ea043; white-space:nowrap;
              background:rgba(46,160,67,.12); border:1px solid rgba(46,160,67,.35); }
  a { color:#0a79d6; }
  @media (max-width: 920px) { .nf-split { flex-direction:column; } .nf-hero { padding:32px 24px; } }
`;

export function App() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [wsInput, setWsInput] = useState("ping");
  const [wsLog, setWsLog] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);
<% if (it.complete) { %>  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [secureData, setSecureData] = useState<SecureData | null>(null);
<% } %>
  // Rappelé après login/logout : la zone firewall `main` (^/api) résout
  // l'identité par requête → `who` change sans recharger la page.
  const refreshHello = () =>
    fetch("/api/hello")
      .then((r) => r.json())
      .then((j) => {
        const d = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
        setData(d);
<% if (it.complete) { %>        // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
        // ^/api/secure : sans session le firewall répond 401 avant le controller).
        if (d.who && d.who !== "anonyme") {
          fetch("/api/secure/hello", { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((s) =>
              setSecureData(s ? ((s.result ?? s) as SecureData) : null),
            )
            .catch(() => setSecureData(null));
        } else {
          setSecureData(null);
        }
<% } %>      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
<% if (it.complete) { %>
  // Flux session BFF du framework (cookie opaque HttpOnly — le front ne voit
  // jamais de token) : mêmes endpoints que le login de la console /nodefony.
  const doLogin = async () => {
    setAuthMsg(null);
    const r = await fetch("/nodefony/security/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    const j = (await r.json()) as { result?: { user?: { username?: string } }; user?: { username?: string } };
    if (!r.ok) {
      setAuthMsg("identifiants invalides");
      return;
    }
    const u = j.result?.user ?? j.user;
    setAuthMsg(`session ouverte — ${u?.username ?? username}`);
    refreshHello();
  };

  const doLogout = async () => {
    await fetch("/nodefony/security/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setAuthMsg("session fermée");
    refreshHello();
  };
<% } %>
  useEffect(() => {
    refreshHello();

    // WS même origine que la page (ws en http, wss en https).
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
  }, []);

  const sendWs = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(wsInput);
      setWsLog((log) => [...log.slice(-4), `→ ${wsInput}`]);
    }
  };

  return (
    <div className="nf-split">
      <style>{CSS}</style>

      {/* ── Panneau de marque (même design que le login Studio) ─────────── */}
      <aside className="nf-hero">
        <div className="nf-glow" aria-hidden />
        <div style={{ display: "flex", gap: 14, alignItems: "center", position: "relative" }}>
          <img src={NODEFONY_LOGO} alt="Nodefony" height={42} draggable={false} />
          <span style={{ fontWeight: 700, fontSize: 26 }}><%= it.appName %></span>
        </div>

        <div style={{ maxWidth: 480, position: "relative" }}>
          <h1>Le temps réel, nativement.</h1>
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
                <div style={{ fontSize: 14, color: "rgba(255,255,255,.78)" }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.65)" }}>
            Nodefony 10 · licence CeCILL-B
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
          {secureData && <span className="nf-hello">👋 {secureData.message}</span>}
<% } %>        </header>
        <p className="nf-dim">
          <%= it.complete ? "Quatre" : "Trois" %> preuves interactives — édite <code>frontend/src/App.tsx</code>,
          la page se met à jour par HMR sans perdre le compteur.
        </p>

        <div className="nf-card">
<% if (it.complete) { %>          <h2>1. Backend HTTP — <code>GET {secureData ? "/api/secure/hello" : "/api/hello"}</code></h2>
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
          <h2>2. Firewall — l'identité vit dans la zone <code>^/api</code></h2>
          <p className="nf-dim">
            Deux zones dans <code>nodefony.config.ts</code> : <code>main</code>{" "}
            (<code>^/api</code>, session → anonymous, jamais bloquante) et{" "}
            <code>secure</code> (<code>^/api/secure</code>, session SEULE —
            pattern plus spécifique, il gagne le match ; sans session le
            firewall répond 401). Connecte-toi (compte dev seedé{" "}
            <code>admin / admin</code>) : la carte 1 bascule sur{" "}
            <code>GET /api/secure/hello</code> → « Bonjour admin ».
          </p>
          {data?.who && data.who !== "anonyme" ? (
            <>
              <span>
                connecté — <strong>{data.who}</strong>
              </span>{" "}
              <button onClick={doLogout}>Se déconnecter</button>
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
                onKeyDown={(e) => e.key === "Enter" && doLogin()}
                autoComplete="current-password"
                aria-label="mot de passe"
              />{" "}
              <button onClick={doLogin}>Se connecter</button>
            </>
          )}
          {authMsg && <p className="nf-dim">{authMsg}</p>}
        </div>
<% } %>
        <div className="nf-card">
          <h2><%= it.complete ? 3 : 2 %>. WebSocket — MÊME controller que le HTTP</h2>
          <p className="nf-dim">
            <code>HelloController</code> porte la route GET <em>et</em> la route
            WEBSOCKET : un seul pipeline (firewall, audit, logs).
          </p>
          <input
            value={wsInput}
            onChange={(e) => setWsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendWs()}
          />{" "}
          <button onClick={sendWs}>Envoyer en WS</button>
          <pre>{wsLog.join("\n") || "(envoie un message)"}</pre>
        </div>

        <div className="nf-card">
          <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check — état React préservé</h2>
          <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
          <p className="nf-dim">
            Édite <code>frontend/src/App.tsx</code> — Vite recompile à la volée,
            la page se met à jour <em>sans recharger</em> et le compteur est
            conservé.
          </p>
        </div>

        <p className="nf-dim">
          Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
        </p>
      </main>
    </div>
  );
}
