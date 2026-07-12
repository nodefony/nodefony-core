import { useEffect, useRef, useState } from "react";

interface ApiData {
  hello: string;
  pid: number;
}

/**
 * Vitrine interactive de l'app — trois preuves en une page :
 *  1. HTTP    : fetch de TON backend (`/api` proxifié vers Nodefony par
 *               `apiProxyPaths` — sans lui, Vite répondrait son HTML).
 *  2. WS      : echo WebSocket LIVE sur le MÊME controller que le HTTP
 *               (le différenciateur Nodefony), via le WebSocket natif.
 *  3. React   : état local + HMR — édite ce fichier, la page se met à
 *               jour sans recharger ni perdre le compteur.
 */
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
    return () => socket.close();
  }, []);

  const sendWs = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(wsInput);
      setWsLog((log) => [...log.slice(-4), `→ ${wsInput}`]);
    }
  };

  const card: React.CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  };

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1><%= it.appName %></h1>
      <p>
        React 19 + Vite (HMR) servi par Nodefony — édite{" "}
        <code>frontend/src/App.tsx</code> et regarde la page se mettre à jour
        sans perdre le compteur.
      </p>

      <div style={card}>
        <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
        {error ? (
          <pre style={{ color: "crimson" }}>{error}</pre>
        ) : data ? (
          <pre>{JSON.stringify(data, null, 2)}</pre>
        ) : (
          <p>loading…</p>
        )}
      </div>

      <div style={card}>
        <h2>2. WebSocket — MÊME controller que le HTTP</h2>
        <p style={{ color: "#666" }}>
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

      <div style={card}>
        <h2>3. État React + HMR</h2>
        <button onClick={() => setCount((c) => c + 1)}>count = {count}</button>
      </div>

      <p style={{ color: "#666" }}>
        Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
      </p>
    </div>
  );
}
