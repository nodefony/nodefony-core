/// <reference types="vite/client" />

// Shim TS pour les imports `*.vue` (Single File Components).
// Non compilé par le tsconfig backend (frontend exclu) — sert l'IDE + esbuild.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}
