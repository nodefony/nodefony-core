import { useEffect, useState } from "react";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

export function App() {
  const [count, setCount] = useState(0);
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/poc/api/data");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { result?: ApiData } & ApiData;
        if (!cancelled) {
          // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
          setData((json.result ?? json) as ApiData);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>POC @nodefony/frontend — branche child_process</h1>
      <p>
        Vite tourne dans un process système séparé (spawn). Le backend Nodefony
        ne le voit pas sur son event-loop.
      </p>

      <section style={{ marginTop: 16 }}>
        <h2>HMR check</h2>
        <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
        <p style={{ marginTop: 8, color: "#555" }}>
          Édite <code>frontend/src/App.tsx</code> — Vite recompile, HMR
          conserve l'état du compteur.
        </p>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Backend ping (GET /poc/api/data)</h2>
        {error ? (
          <pre style={{ color: "crimson" }}>{error}</pre>
        ) : data ? (
          <pre>{JSON.stringify(data, null, 2)}</pre>
        ) : (
          <p>loading…</p>
        )}
      </section>
    </div>
  );
}
