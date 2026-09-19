- **Le geste concret avec `nodefony/react`** — les hooks React du
  paquet `nodefony`, résolus à l'identique par Vite, Node et le typecheck. Le
  fournisseur est monté une fois ; un composant s'abonne ensuite sans jamais
  toucher à la socket, et l'abonnement se libère au démontage :

```tsx
// frontend/src/App.tsx — ce que l'écran d'accueil généré fait déjà
import { NodefonyProvider, useNodefonyChannelData } from "nodefony/react";

function Live() {
  const last = useNodefonyChannelData<{ message: string }>("live:events");
  return <p>{last?.message ?? "en attente…"}</p>;
}

export function App() {
  return (
    <NodefonyProvider url="/api/live/realtime">
      <Live />
    </NodefonyProvider>
  );
}
```

Les autres hooks (`useNodefony`, `useNodefonyState`, `useNodefonyIdentity`,
`useNodefonyChannel`), le comptage de références et les notices :
`node_modules/nodefony/docs/react-hooks.md`.
