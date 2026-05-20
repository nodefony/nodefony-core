import { useEffect, useState, version as reactVersion } from "react";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

const STYLES = `
.page {
  min-height: 100vh;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.5rem;
  padding: 4rem 1.5rem;
  box-sizing: border-box;
  font-family: "Inter", system-ui, -apple-system, sans-serif;
  color: #213547;
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(97, 218, 251, 0.22), transparent),
    #f6fafd;
}
.hero { text-align: center; max-width: 640px; }
.logo {
  width: 110px;
  height: auto;
  filter: drop-shadow(0 6px 16px rgba(20, 158, 202, 0.25));
  animation: spin 16s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.hero h1 {
  margin: 1.2rem 0 0.6rem;
  font-size: 2.6rem;
  font-weight: 800;
  background: linear-gradient(120deg, #61dafb, #149eca);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.subtitle { margin: 0 auto; font-size: 1.05rem; line-height: 1.6; color: #46606f; }
.badges {
  margin-top: 1.4rem; display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: center;
}
.badge {
  padding: 0.32rem 0.85rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600;
  background: #e6f3f9; color: #149eca; border: 1px solid #cfe8f3;
}
.badge--react { background: #149eca; color: #fff; border-color: #149eca; }
.cards {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem; width: 100%; max-width: 760px;
}
.card {
  background: #fff; border: 1px solid #e3eef3; border-radius: 16px;
  padding: 1.4rem 1.5rem; box-shadow: 0 10px 30px rgba(20, 158, 202, 0.07);
}
.card h2 { margin: 0 0 1rem; font-size: 1.15rem; }
.counter {
  font: inherit; font-weight: 600; cursor: pointer; padding: 0.6rem 1.1rem;
  border-radius: 10px; border: 1px solid #149eca; background: #149eca; color: #fff;
  transition: transform 0.08s ease, box-shadow 0.2s ease;
}
.counter:hover { box-shadow: 0 6px 16px rgba(20, 158, 202, 0.35); }
.counter:active { transform: translateY(1px); }
.hint { margin: 0.9rem 0 0; font-size: 0.9rem; color: #6b7a89; }
.route { display: inline-block; margin-bottom: 0.6rem; font-size: 0.85rem; color: #149eca; }
.out {
  margin: 0; padding: 0.8rem 1rem; border-radius: 10px; background: #0f172a;
  color: #7dd3fc; font-size: 0.85rem; overflow: auto;
}
.out--err { background: #fef2f2; color: #b91c1c; }
.page code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  background: rgba(20, 158, 202, 0.1); padding: 0.1rem 0.35rem; border-radius: 5px;
}
`;

export function App() {
  const [count, setCount] = useState(0);
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/react/api/data");
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
    <main className="page">
      <style>{STYLES}</style>

      <div className="hero">
        <svg
          className="logo"
          viewBox="-11.5 -10.23174 23 20.46348"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="0" cy="0" r="2.05" fill="#61dafb" />
          <g stroke="#61dafb" strokeWidth="1" fill="none">
            <ellipse rx="11" ry="4.2" />
            <ellipse rx="11" ry="4.2" transform="rotate(60)" />
            <ellipse rx="11" ry="4.2" transform="rotate(120)" />
          </g>
        </svg>

        <h1>You did it!</h1>
        <p className="subtitle">
          React&nbsp;19 transpilé par <strong>@nodefony/frontend</strong> via Vite —
          multi-framework aux côtés du bundle Vue, même superviseur.
        </p>

        <div className="badges">
          <span className="badge badge--react">React v{reactVersion}</span>
          <span className="badge">Vite&nbsp;dev&nbsp;server</span>
          {data && <span className="badge">env: {data.env}</span>}
        </div>
      </div>

      <div className="cards">
        <section className="card">
          <h2>♻️ HMR check</h2>
          <button className="counter" onClick={() => setCount((c) => c + 1)}>
            count is {count}
          </button>
          <p className="hint">
            Édite <code>frontend/src/App.tsx</code> — Vite recompile, l'état du
            compteur est conservé.
          </p>
        </section>

        <section className="card">
          <h2>🔌 Backend ping</h2>
          <code className="route">GET /react/api/data</code>
          {error ? (
            <pre className="out out--err">{error}</pre>
          ) : data ? (
            <pre className="out">{JSON.stringify(data, null, 2)}</pre>
          ) : (
            <p className="hint">loading…</p>
          )}
        </section>
      </div>
    </main>
  );
}
