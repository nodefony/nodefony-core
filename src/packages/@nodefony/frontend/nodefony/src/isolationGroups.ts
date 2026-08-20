/**
 * Famille d'isolation Vite d'un type de preset frontend.
 *
 * Les presets d'une même famille **cohabitent dans une seule instance Vite** ;
 * les familles distinctes tournent dans des **process Vite séparés** (multi-
 * supervisor).
 *
 * Pourquoi isoler Angular : son plugin (`@analogjs/vite-plugin-angular`)
 * transforme **tout** fichier `.ts` du dev server — y compris ceux des bundles
 * React/Vue (ex. stores MobX à décorateurs). Mélangé aux autres, il throw sur
 * des fichiers hors de son tsconfig → erreurs de compilation + boucle de reload.
 * React / Vue / vanilla ciblent des extensions disjointes (`.tsx`/`.jsx` vs
 * `.vue`) et cohabitent sans conflit dans la famille `default`.
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
    default:
      // react19, vue3, vanilla, svelte5 → instance partagée.
      return "default";
  }
}

/**
 * Famille servie sur le port de base (`devPort`). Les autres familles prennent
 * les blocs de ports suivants. Garder `default` ici garantit que l'instance
 * principale (React/Vue/Studio) reste sur le port habituel (5173).
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
