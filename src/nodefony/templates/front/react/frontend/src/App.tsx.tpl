import { useState, version as reactVersion } from "react";

/**
 * Page « <%= it.kebab %> » — squelette VOLONTAIREMENT minimal : c'est TA page,
 * pas une vitrine. Le compteur prouve le HMR (édite ce fichier : Vite
 * recompile à la volée, la page se met à jour SANS recharger et l'état est
 * conservé). Les appels backend passent par `fetch("/api/…")` (proxifiés vers
 * Nodefony en dev, cf `apiProxyPaths` du registerEntry).
 */
export function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1><%= it.kebab %></h1>
      <p>
        React v{reactVersion} servi par Nodefony via Vite — entry «{" "}
        <%= it.kebab %> ».
      </p>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
      <p style={{ color: "#666", fontSize: 14 }}>
        Édite <code>frontend/src/App.tsx</code> — HMR sans recharger, compteur
        conservé.
      </p>
    </main>
  );
}
