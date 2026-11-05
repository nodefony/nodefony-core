/// <reference types="vite/client" />

/**
 * Shim d'environnement Svelte (standard Vite) : permet à tsgo/tsc de résoudre
 * les imports de composants. L'INTÉRIEUR des .svelte, `svelte-check` le
 * contrôle : le script `typecheck` l'enchaîne après tsgo.
 */
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
