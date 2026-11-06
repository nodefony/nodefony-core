/**
 * Famille d'isolation Vite d'un type de preset frontend.
 *
 * Les presets d'une même famille **cohabitent dans une seule instance Vite** ;
 * les familles distinctes tournent dans des **process Vite séparés** (multi-
 * supervisor).
 *
 * Deux familles sont isolées, pour deux raisons différentes.
 *
 * Angular : historiquement, son plugin (`@analogjs/vite-plugin-angular`)
 * transformait **tout** `.ts` du serveur et levait sur ceux des autres bundles
 * (stores MobX de Studio) — erreurs + boucle de rechargement. Ce n'est plus le
 * cas (analogjs 2.9.6, Vite 8.3.6 : dans l'instance partagée, HMR à chaud sur
 * React, Svelte, Angular, une page ET un store de Studio, sans erreur ni
 * boucle). Il reste isolé pour le COÛT : son compilateur rend l'instance prête
 * en ~2,6 s au lieu de 0,5-0,7 s, et le superviseur relance les Vite à chaque
 * modification du backend — Studio et React attendraient ~2 s de plus à chaque
 * fois, pour un process et ~100 Mo économisés. Isolé, il démarre en parallèle.
 *
 * Vue : `@vitejs/plugin-react` pose une option oxc GLOBALE
 * (`oxc.jsx.refresh: true`) que le compilateur de Vite neutralise lui-même sur
 * tout fichier qui n'est pas du JSX. `@vitejs/plugin-vue` contourne cette
 * garde : il compile le TypeScript d'un composant en appelant directement
 * `transformWithOxc(…, { ...devServer.config.oxc, lang: "ts" })` (sa fonction
 * `transformMain`), option brute comprise. oxc injecte alors `$RefreshSig$()`
 * dans les fonctions de forme hook du `setup` — que rien ne définit sur une
 * page sans préambule React : la vitrine Vue ne se monte plus
 * (`ReferenceError: $RefreshSig$ is not defined`). Défaut de plugin-vue, suivi
 * en amont : https://github.com/vitejs/vite-plugin-vue/issues/798 (constaté
 * sur plugin-vue 6.0.10, plugin-react 6.2.1, Vite 8.3.6).
 *
 * ⚠️ Aucun filtre du greffon React n'y peut rien (`exclude: [/./]` compris) :
 * l'option est globale, et couper `refresh` casserait le HMR de React. Seule
 * l'isolation en process distinct l'arrête. À lever quand l'amont corrige :
 * la sentinelle `tests/integration/vueRefreshSentinel.test.ts` rougit ce jour-là.
 *
 * Svelte, lui, cohabite sans dommage (constaté) : son bloc script n'est pas
 * servi sous un identifiant qui finit par `.ts`.
 *
 * @param type - type de preset déclaré par le module (`react19`, `vue3`,
 *   `angular`, `vanilla`, …).
 * @returns la clé de famille d'isolation (`"default"` pour tout ce qui peut
 *   partager une instance, une clé dédiée pour ce qui doit être isolé).
 */
export function isolationGroup(type: string): string {
  switch (type) {
    case "angular":
      return "angular";
    case "vue3":
      return "vue";
    default:
      // react19, vanilla, svelte5 → instance partagée.
      return "default";
  }
}

/**
 * Espace d'URL réservé aux serveurs Vite de développement, sur l'origine de
 * Nodefony. Chaque famille y a son sous-préfixe (cf {@link devBasePath}).
 */
export const DEV_BASE_ROOT = "/_vite/";

/**
 * Chemin de base Vite d'une famille en développement (`/_vite/<famille>/`).
 *
 * Vite fabrique ses URLs d'assets RELATIVES AU DOCUMENT : une image importée
 * devient `/<base>/src/logo.png`, que le navigateur résout contre l'origine de
 * la page — servie par Nodefony, pas par Vite. Un préfixe réservé rend ces
 * URLs reconnaissables : Nodefony les relaie (307) vers le serveur Vite, sans
 * collision possible avec les routes de l'application. Un préfixe PAR famille,
 * parce que chaque famille a son instance Vite, sur son port : le relais doit
 * savoir vers laquelle renvoyer.
 *
 * `base` est l'option que Vite honore partout — dev classique, dev bundlé,
 * socket HMR, `@vitejs/plugin-vue`, publicDir —, contrairement à
 * `server.origin`, ignoré en mode bundlé.
 *
 * @param family - clé de famille ({@link isolationGroup})
 * @returns le chemin, `/` en tête et en fin
 */
export function devBasePath(family: string): string {
  return `${DEV_BASE_ROOT}${family}/`;
}

/**
 * Famille servie sur le port de base (`devPort`). Les autres familles prennent
 * les blocs de ports suivants. Garder `default` ici garantit que l'instance
 * principale (React/Svelte/vanilla/Studio) reste sur le port habituel (5173).
 */
export const PRIMARY_FAMILY = "default";

/**
 * Ordonne les familles de façon déterministe : la famille primaire d'abord
 * (port de base), puis les autres triées alphabétiquement. L'ordre fixe le
 * port attribué à chaque famille — il doit être stable entre deux démarrages.
 *
 * @param families - familles présentes (clés de regroupement des entries).
 * @returns familles ordonnées, `PRIMARY_FAMILY` en tête s'il est présent.
 */
export function orderFamilies(families: ReadonlyArray<string>): string[] {
  const others = families.filter((f) => f !== PRIMARY_FAMILY).sort();
  return families.includes(PRIMARY_FAMILY)
    ? [PRIMARY_FAMILY, ...others]
    : others;
}

/**
 * Plan d'allocation des ports : un **bloc disjoint** par famille. Chaque famille
 * réserve `portRetryAttempts + 1` ports consécutifs → le port-retry d'une
 * instance (sur EADDRINUSE) ne peut jamais empiéter sur le bloc d'une autre
 * famille. La famille primaire (index 0) garde `devPort` (le port habituel).
 *
 * @param devPort - port de base de la première famille (ex. 5173).
 * @param families - familles présentes ; réordonnées en interne via `orderFamilies`.
 * @param portRetryAttempts - tentatives de port-retry par instance (bloc = +1).
 * @returns map ordonnée `famille → port de base de son bloc`.
 */
export function familyPortPlan(
  devPort: number,
  families: ReadonlyArray<string>,
  portRetryAttempts: number,
): Map<string, number> {
  const block = portRetryAttempts + 1;
  const plan = new Map<string, number>();
  orderFamilies(families).forEach((family, index) => {
    plan.set(family, devPort + index * block);
  });
  return plan;
}
