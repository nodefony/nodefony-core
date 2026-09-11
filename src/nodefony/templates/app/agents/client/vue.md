- **Le geste concret avec `nodefony/vue`** — les composables Vue du
  paquet `nodefony`, résolus à l'identique par Vite, Node et le typecheck. La
  politique s'installe comme un plugin, une seule fois dans `main.ts` ; un
  composant s'abonne ensuite sans jamais toucher à la socket, et la fin de
  portée libère l'abonnement :

```ts
// frontend/src/main.ts — ce que l'entrée générée fait déjà
import { createApp } from "vue";
import { nodefonyVue } from "nodefony/vue";
import App from "./App.vue";

createApp(App).use(nodefonyVue, { url: "/api/live/realtime" }).mount("#app");
```

```ts
// dans le <script setup> d'un composant
import { useNodefonyChannelData } from "nodefony/vue";

const last = useNodefonyChannelData<{ message: string }>("live:events");
```

Les autres composables (`useNodefony`, `useNodefonyState`,
`useNodefonyIdentity`, `useNodefonyChannel`) et les trois règles que Vue impose :
`node_modules/nodefony/docs/vue-composables.md`.
