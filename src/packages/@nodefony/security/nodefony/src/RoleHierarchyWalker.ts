/**
 * Résout la hiérarchie de rôles — `ROLE_ADMIN` hérite `ROLE_USER`, etc.
 *
 * Aplatissement DFS **précalculé au boot** (lecture O(1) au runtime, hot-path) +
 * **détection de cycles au boot** (throw avec le chemin complet, pas de fail-silent).
 * Niveau A de l'autorisation (P6.8).
 */
export class RoleHierarchyWalker {
  // role → set de tous les rôles hérités (transitif, aplati au boot).
  readonly #flat = new Map<string, Set<string>>();

  constructor(hierarchy: Record<string, readonly string[]> = {}) {
    this.#detectCycles(hierarchy);
    this.#precompute(hierarchy);
  }

  /**
   * L'utilisateur (rôles plats) possède-t-il le rôle requis, hiérarchie résolue ?
   *
   * @param userRoles - rôles plats de l'utilisateur.
   * @param required - rôle exigé.
   */
  hasRole(userRoles: readonly string[], required: string): boolean {
    for (const role of userRoles) {
      if (role === required) return true;
      const inherited = this.#flat.get(role);
      if (inherited?.has(required)) return true;
    }
    return false;
  }

  /** Ensemble complet des rôles atteignables (plats + hérités). */
  reachableRoles(userRoles: readonly string[]): Set<string> {
    const out = new Set<string>(userRoles);
    for (const role of userRoles) {
      const inherited = this.#flat.get(role);
      if (inherited) {
        for (const r of inherited) out.add(r);
      }
    }
    return out;
  }

  #precompute(hierarchy: Record<string, readonly string[]>): void {
    for (const role of Object.keys(hierarchy)) {
      this.#flat.set(role, this.#flatten(role, hierarchy));
    }
  }

  #flatten(
    role: string,
    hierarchy: Record<string, readonly string[]>,
  ): Set<string> {
    const out = new Set<string>();
    const stack: string[] = [...(hierarchy[role] ?? [])];
    while (stack.length) {
      const current = stack.pop() as string;
      if (out.has(current)) continue;
      out.add(current);
      const children = hierarchy[current];
      if (children) {
        for (const child of children) stack.push(child);
      }
    }
    return out;
  }

  // DFS coloré — GRAY = en cours de visite → un arc vers un GRAY = cycle.
  #detectCycles(hierarchy: Record<string, readonly string[]>): void {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const path: string[] = [];

    const visit = (node: string): void => {
      color.set(node, GRAY);
      path.push(node);
      for (const next of hierarchy[node] ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          const start = path.indexOf(next);
          const cycle = [...path.slice(start), next].join(" → ");
          throw new Error(`RoleHierarchy: cycle détecté — ${cycle}`);
        }
        if (c === WHITE && hierarchy[next]) visit(next);
      }
      path.pop();
      color.set(node, BLACK);
    };

    for (const node of Object.keys(hierarchy)) {
      if ((color.get(node) ?? WHITE) === WHITE) visit(node);
    }
  }
}

export default RoleHierarchyWalker;
