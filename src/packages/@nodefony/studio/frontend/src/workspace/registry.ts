/**
 * Catalogue global des widgets — le « magasin d'apps ». Peuplé par side-effect au
 * premier `import "./widgets"`. Lookup O(1) par id ; liste filtrée par rôle.
 */
import type { IWidgetDef, WidgetCategory } from "./types";
// `roleNames` et NON `roles` : le catalogue est atteint au top-level depuis les
// stores, et `roles.ts` importe les stores — y passer refermerait un cycle.
import { isVisibleForRoles, VIEW_ROLES } from "../auth/roleNames";

const REGISTRY = new Map<string, IWidgetDef>();

/**
 * Politique de visibilité PAR CATÉGORIE — défaut appliqué quand un bloc ne fixe
 * pas son propre `roles`. Évite de tagger les 24 blocs un par un (1 endroit =
 * 0 dérive avec la nav). Un bloc surcharge via `def.roles` (ex. un futur bloc
 * sécurité self-service met `roles: []` pour rester visible par tous). L'admin
 * Nodefony voit tout (via `isVisibleForRoles`).
 */
const CATEGORY_ROLES: Partial<Record<WidgetCategory, readonly string[]>> = {
  runtime: VIEW_ROLES.devops,
  system: VIEW_ROLES.devops,
  realtime: VIEW_ROLES.devops,
  logs: VIEW_ROLES.devops,
  cluster: VIEW_ROLES.ops,
  orm: VIEW_ROLES.dev,
  ai: VIEW_ROLES.dev,
  security: VIEW_ROLES.admin,
};

/**
 * Enregistre un widget. Le générique `T` reste typé côté composant ; on l'efface à
 * l'entrée du registry (boundary contrôlée — le shell passe une donnée `unknown` au
 * rendu, chaque widget narrow depuis sa propre source).
 */
export function registerWidget<T>(def: IWidgetDef<T>): void {
  REGISTRY.set(def.id, def as unknown as IWidgetDef);
}

export function getWidget(id: string): IWidgetDef | undefined {
  return REGISTRY.get(id);
}

export function hasWidget(id: string): boolean {
  return REGISTRY.has(id);
}

/**
 * Tous les widgets visibles pour ces rôles. Visibilité = `def.roles` explicite,
 * sinon défaut de catégorie (`CATEGORY_ROLES`), sinon visible par tous ; l'admin
 * Nodefony voit tout. Source UNIQUE de la règle d'affichage du catalogue.
 */
export function listWidgets(roles: string[] = []): IWidgetDef[] {
  const out: IWidgetDef[] = [];
  for (const def of REGISTRY.values()) {
    const required = def.roles ?? CATEGORY_ROLES[def.category];
    if (isVisibleForRoles(required, roles)) out.push(def);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
