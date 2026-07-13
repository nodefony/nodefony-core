/// <reference types="vite/client" />

/**
 * Shim d'environnement Vue (standard Vite) : permet à tsgo/tsc de résoudre
 * les imports de SFC. Le typecheck de l'INTÉRIEUR des .vue relève de vue-tsc.
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}
