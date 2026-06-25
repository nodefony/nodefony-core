import Router from "../service/router";
import { extractActionScopes } from "../decorators/routerDecorators";

/**
 * Un groupe de scopes d'**une API** — le préfixe avant `:` (`orders`) et la liste
 * (triée) de ses scopes déclarés (`orders:read`, `orders:write`). Un scope sans
 * `:` (ex. `@RequireScope("orders")` = toute l'API) se groupe sous lui-même.
 */
export interface IApiScopeGroup {
  /** Préfixe d'API (segment avant le `:`). */
  readonly api: string;
  /** Scopes `api:action` déclarés pour cette API, triés et dédupliqués. */
  readonly scopes: readonly string[];
}

/**
 * P6.8 — **Découverte au boot** : scanne TOUTES les routes montées (`Router.routes`)
 * et agrège les scopes déclarés par `@RequireScope`, **regroupés par API** (préfixe
 * avant `:`). C'est la source du formulaire « créer une clé API » de Studio : les
 * scopes proposés DÉRIVENT du code (les routes), au lieu d'une liste plate de config
 * qui se périme dès qu'on ajoute un `@RequireScope` sans penser à la config.
 *
 * **Cold path** : appelé à la demande (ouverture du formulaire), jamais sur le hot
 * path requête. Lecture `Reflect` par route → coût proportionnel au nombre de routes,
 * payé une fois par consultation.
 *
 * @returns les groupes triés par nom d'API (chaque groupe a ses scopes triés).
 */
export function collectDeclaredApiScopes(): IApiScopeGroup[] {
  const byApi = new Map<string, Set<string>>();
  for (const route of Router.routes) {
    const ctor = route.controller;
    const method = route.classMethod;
    if (!ctor || !method) continue;
    for (const scope of extractActionScopes(ctor, method)) {
      const i = scope.indexOf(":");
      const api = i === -1 ? scope : scope.slice(0, i);
      let set = byApi.get(api);
      if (set === undefined) {
        set = new Set();
        byApi.set(api, set);
      }
      set.add(scope);
    }
  }
  return [...byApi.keys()]
    .sort()
    .map((api) => ({ api, scopes: [...byApi.get(api)!].sort() }));
}

export default collectDeclaredApiScopes;
