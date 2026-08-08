/// <reference types="vite/client" />

/**
 * Shim d'environnement Svelte (standard Vite) : permet à tsgo/tsc de résoudre
 * les imports de composants. Le typecheck de l'INTÉRIEUR des .svelte relève
 * de svelte-check.
 */
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
