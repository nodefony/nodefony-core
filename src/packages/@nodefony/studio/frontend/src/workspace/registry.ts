/**
 * Catalogue global des widgets — le « magasin d'apps ». Peuplé par side-effect au
 * premier `import "./widgets"`. Lookup O(1) par id ; liste filtrée par rôle.
 */
import type { IWidgetDef } from "./types";

const REGISTRY = new Map<string, IWidgetDef>();

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

/** Tous les widgets visibles pour ces rôles (un widget sans `roles` = visible). */
export function listWidgets(roles: string[] = []): IWidgetDef[] {
  const out: IWidgetDef[] = [];
  for (const def of REGISTRY.values()) {
    if (
      !def.roles ||
      def.roles.length === 0 ||
      def.roles.some((r) => roles.includes(r))
    ) {
      out.push(def);
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
