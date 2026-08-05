/// <reference types="vite/client" />

// Shim TS pour les imports `*.svelte` (composants).
// Non compilé par le tsconfig backend (frontend exclu) — sert l'IDE + esbuild.
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
