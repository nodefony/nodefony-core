import { useEffect, useState } from "react";

interface ApiData {
  hello: string;
  pid: number;
}

/**
 * L'app fetch SON backend (même origine) : `/api` est proxifié vers Nodefony
 * par `apiProxyPaths` (cf `registerEntry` dans index.ts) — sans lui, Vite
 * répondrait son SPA-fallback HTML au lieu du JSON.
 */
export function App() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((j) => setData((j.result ?? j) as ApiData)) // Nodefony wrappe `{ result }`
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1><%= it.appName %></h1>
      <p>React 19 + Vite (HMR) servi par Nodefony — édite ce fichier et regarde.</p>
      {error ? (
        <pre style={{ color: "crimson" }}>{error}</pre>
      ) : data ? (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <p>loading…</p>
      )}
    </div>
  );
}
