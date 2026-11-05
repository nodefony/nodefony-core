/// <reference types="vite/client" />

/**
 * Shim d'environnement Vue (standard Vite) : permet à tsgo/tsc de résoudre
 * les imports de SFC. L'INTÉRIEUR des .vue, `vue-tsc` le contrôle : le script
 * `typecheck` l'enchaîne après tsgo.
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
