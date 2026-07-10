# Spécifique par framework — nodefony-create-frontend-module

Référencé par `SKILL.md` (Phase 2.1, 2.5). Templates **minimaux** ; pour un résultat riche
(SVG logo, HMR counter, styles), copier/adapter le module canonique `src/modules/test-frontend-{fw}/frontend/`.

Variables : `{MOD}`, `{MOD_PASCAL}`, `{ROUTE}` (voir SKILL.md Phase 0).

---

## React 19

**Nœud de montage** : `<div id="root"></div>` · **type** `react19` · **entry** `./frontend/src/main.tsx`

**peerDeps** (`package.json`) :

```json
"react": ">=19.0.0",
"react-dom": ">=19.0.0"
```

**`frontend/src/main.tsx`** :

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`frontend/src/App.tsx`** :

```tsx
import { useEffect, useState } from "react";
interface ApiData {
  ts: number;
  env: string;
}
export function App() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("{ROUTE}/api/data")
      .then((r) => r.json())
      .then((j) => setData((j.result ?? j) as ApiData)) // Nodefony wrappe `{ result }`
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>{MOD_PASCAL}</h1>
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
```

**Gotcha React — preamble** : ne JAMAIS injecter les `<script>` à la main. `svc.renderTags(name)`
inline le preamble Fast Refresh pour les entries `type:"react19"`. Sans lui :
`@vitejs/plugin-react can't detect preamble`.

---

## Vue 3

**Nœud de montage** : `<div id="app"></div>` · **type** `vue3` · **entry** `./frontend/src/main.ts`

**peerDeps** (`package.json`) :

```json
"vite": ">=5.0.0",
"@vitejs/plugin-vue": ">=5.0.0"
```

(+ `vue` installé à la racine du repo.)

**`frontend/src/main.ts`** :

```ts
import { createApp } from "vue";
import App from "./App.vue";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
createApp(App).mount(el);
```

**`frontend/src/App.vue`** (SFC `<script setup>`) :

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
interface ApiData {
  ts: number;
  env: string;
}
const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
onMounted(async () => {
  try {
    const r = await fetch("{ROUTE}/api/data");
    const j = (await r.json()) as { result?: ApiData } & ApiData;
    data.value = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>
<template>
  <main style="font-family: system-ui; padding: 24px">
    <h1>{MOD_PASCAL}</h1>
    <pre v-if="error" style="color: crimson">{{ error }}</pre>
    <pre v-else-if="data">{{ JSON.stringify(data, null, 2) }}</pre>
    <p v-else>loading…</p>
  </main>
</template>
```

**Pas de preamble** : Vue se monte seul, le `TemplateHelper` reste générique.

---

## Angular 21 (standalone, zoneless)

**Nœud de montage** : `<app-root></app-root>` · **type** `angular` · **entry** `./frontend/src/main.ts`

**deps** : Angular passe par des **devDependencies** (pas peerDeps react-style) dans le module :

```json
"devDependencies": {
  "@analogjs/vite-plugin-angular": "^2.5.0",
  "@angular/build": "^21.0.0",
  "@angular/compiler-cli": "^21.0.0"
}
```

(+ `@angular/core` `@angular/common` `@angular/platform-browser` installés à la racine).
peerDeps module : `vite >=5.0.0` (le plugin angular est chargé lazy par `@nodefony/frontend`).

**`frontend/src/main.ts`** :

```ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
import { AppComponent } from "./app/app.component";

// Zoneless (Angular 20+) : pas de zone.js, détection pilotée par signals.
bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
```

**`frontend/src/app/app.component.ts`** :

```ts
import { Component, OnInit, signal } from "@angular/core";
interface ApiData {
  ts: number;
  env: string;
}
@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main style="font-family: system-ui; padding: 24px">
      <h1>{MOD_PASCAL}</h1>
      @if (error(); as e) { <pre style="color:crimson">{{ e }}</pre> }
      @else if (data(); as d) { <pre>{{ stringify(d) }}</pre> }
      @else { <p>loading…</p> }
    </main>`,
})
export class AppComponent implements OnInit {
  data = signal<ApiData | null>(null);
  error = signal<string | null>(null);
  stringify = (v: unknown) => JSON.stringify(v, null, 2);
  async ngOnInit() {
    try {
      const r = await fetch("{ROUTE}/api/data");
      const j = (await r.json()) as { result?: ApiData } & ApiData;
      this.data.set((j.result ?? j) as ApiData); // Nodefony wrappe `{ result }`
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
```

**`frontend/tsconfig.app.json`** (REQUIS — scope le plugin Angular au frontend angular seul) :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": []
  },
  "angularCompilerOptions": { "strictTemplates": true },
  "files": ["src/main.ts"],
  "include": ["src/**/*.ts"]
}
```

**`rolldown.config.ts`** — externaliser Angular + AnalogJS (compiler-cli a un interop CJS de
`typescript` que le bundler ne sait pas bundler) :

```ts
const external = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/frontend",
  "tslib",
];
// + ne pas bundler @analogjs/* ni @angular/* (résolus côté Vite, pas côté backend rolldown)
```

### Gotchas Angular (bloquants si oubliés — cf project_frontend_angular_plan)

1. **ERESOLVE TS6** : `@angular/build@21` peer `typescript <6.0` mais repo en TS 6.x → installer
   avec `--legacy-peer-deps`. `@angular/compiler-cli` (le vrai check runtime) accepte `<6.1` → OK en pratique.
2. **Scoping `.ts`** : le plugin Angular transforme TOUS les `.ts` (extension non dédiée) → le
   `tsconfig.app.json` (`include` = frontend angular only) évite de casser le `main.ts` des autres bundles (Vue).
   Le generator passe ce tsconfig en chemin **ABSOLU** (cwd Vite = `entries[0].root` ≠ root angular en multi-bundle).
3. **`useDefineForClassFields: false`** REQUIS sinon le DI Angular casse.
4. **HMR = page reload** (état perdu), pas hot-swap comme React/Vue.
5. `--legacy-peer-deps` ne réinstalle PAS les peers optionnels → vérifier que `@vitejs/plugin-react`
   des autres bundles n'a pas sauté.
