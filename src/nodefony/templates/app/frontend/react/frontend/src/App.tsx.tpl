import { useEffect, useRef, useState } from "react";

interface ApiData {
  hello: string;
  pid: number;
}

/**
 * Page d'accueil de l'app — vitrine AUTONOME (zéro dépendance UI) :
 *  - panneau de marque (même design que le login de Studio : dégradé, glow,
 *    logo, slogan, 3 piliers du framework) ;
 *  - trois preuves INTERACTIVES : fetch HTTP, echo WebSocket live sur le MÊME
 *    controller (le différenciateur Nodefony), état React préservé par HMR.
 * Édite ce fichier : la page se met à jour sans recharger ni perdre le compteur.
 */

/** Logo officiel Nodefony (data-URI — aucun asset externe, thème-safe). */
const LOGO =
  "data:image/png;base64,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";

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

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((j) => setData((j.result ?? j) as ApiData)) // Nodefony wrappe `{ result }`
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

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
          <img src={LOGO} alt="Nodefony" height={42} draggable={false} />
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
        <h1 style={{ marginTop: 0 }}>Votre app est en ligne.</h1>
        <p className="nf-dim">
          Trois preuves interactives — édite <code>frontend/src/App.tsx</code>,
          la page se met à jour par HMR sans perdre le compteur.
        </p>

        <div className="nf-card">
          <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
          {error ? (
            <pre style={{ color: "crimson" }}>{error}</pre>
          ) : data ? (
            <pre>{JSON.stringify(data, null, 2)}</pre>
          ) : (
            <p>loading…</p>
          )}
        </div>

        <div className="nf-card">
          <h2>2. WebSocket — MÊME controller que le HTTP</h2>
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
          <h2>3. État React + HMR</h2>
          <button onClick={() => setCount((c) => c + 1)}>count = {count}</button>
        </div>

        <p className="nf-dim">
          Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
        </p>
      </main>
    </div>
  );
}
