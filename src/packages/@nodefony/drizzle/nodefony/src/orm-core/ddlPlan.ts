/**
 * Ordre de création des tables, et contraintes qu'il faut renoncer à poser.
 *
 * Module **pur** (aucune base, aucun Drizzle) : c'est la seule partie du DDL
 * dérivé qui demande un raisonnement, donc la seule qui mérite d'être éprouvée
 * sans serveur — un cycle entre entités ne se reproduit pas à la demande sur une
 * base réelle.
 *
 * Une clé étrangère se déclare **dans** le `CREATE TABLE` : la table visée doit
 * donc exister AVANT celle qui la désigne. Un ordre quelconque échoue sur la
 * première relation rencontrée, et l'application ne démarre pas.
 */

/**
 * Une clé étrangère RÉSOLUE en noms SQL — prête à être écrite dans un
 * `CREATE TABLE`, sans plus aucune référence à un objet Drizzle.
 */
export interface IResolvedForeignKey {
  /** Nom de la contrainte — explicite, car MySQL l'exige unique pour la base. */
  readonly name: string;
  /** Colonnes porteuses, côté table courante. */
  readonly columns: readonly string[];
  /** Table visée. */
  readonly foreignTable: string;
  /** Colonnes visées, dans le même ordre que {@link columns}. */
  readonly foreignColumns: readonly string[];
  /** Politique d'effacement du parent (`restrict`, `set null`, `cascade`…). */
  readonly onDelete?: string;
  /** Politique de mise à jour de la clé du parent. */
  readonly onUpdate?: string;
}

/** Une table à créer, et les tables que ses clés étrangères désignent. */
export interface ITableDependency {
  /** Nom SQL de la table. */
  readonly name: string;
  /**
   * Tables visées par ses clés étrangères, dans l'ordre de déclaration.
   *
   * Une table peut y figurer plusieurs fois (deux colonnes vers la même cible) ;
   * elle peut aussi s'y désigner elle-même, ce qui ne crée aucune dépendance.
   */
  readonly references: readonly string[];
}

/** Une contrainte qu'on renonce à poser, et la raison qui le commande. */
export interface IOmittedForeignKey {
  /** Table qui porte la clé étrangère. */
  readonly table: string;
  /** Table visée. */
  readonly target: string;
  /**
   * `cycle` : la cible dépend à son tour de cette table, directement ou non —
   * aucun ordre de création ne satisfait les deux.
   * `absent` : la cible n'appartient pas à ce connecteur, donc à cette base.
   */
  readonly reason: "cycle" | "absent";
}

/** Ordre de création, et ce qu'il a fallu abandonner en chemin. */
export interface IDdlPlan {
  /** Noms des tables, dans l'ordre où les créer. */
  readonly order: readonly string[];
  /** Clés étrangères non émises — jamais silencieuses, l'appelant les journalise. */
  readonly omitted: readonly IOmittedForeignKey[];
}

/**
 * Trie les tables pour que chaque cible naisse avant qui la désigne.
 *
 * Tri topologique (Kahn) sur le graphe des dépendances, avec deux écarts
 * assumés au manuel :
 *
 * - **l'auto-référence ne compte pas** (`parent:ref:Category` dans `Category`) :
 *   les trois moteurs acceptent une contrainte qui vise la table en cours de
 *   création, dans le même `CREATE TABLE` ;
 * - **un cycle ne fait pas échouer le démarrage**. Il n'y a aucun ordre correct,
 *   mais refuser de démarrer pour ça serait hors de proportion : on crée les
 *   tables du cycle dans un ordre stable, et on OMET les contraintes qui
 *   regardent en arrière. Elles sont rendues à l'appelant pour qu'il les dise —
 *   une garantie qui disparaît sans un mot est pire que son absence.
 *
 * À ordre de sortie stable : les tables prêtes sont prises par ordre
 * alphabétique, jamais dans l'ordre d'arrivée. Deux démarrages de la même
 * application produisent donc le même DDL, ce qui rend un journal comparable.
 *
 * @param tables - les tables du connecteur et leurs cibles.
 * @returns l'ordre de création et les contraintes abandonnées.
 */
export function planTableCreation(
  tables: readonly ITableDependency[],
): IDdlPlan {
  const known = new Set(tables.map((table) => table.name));
  const omitted: IOmittedForeignKey[] = [];

  /** Dépendances RÉELLES : cible connue, et différente de la table elle-même. */
  const dependencies = new Map<string, Set<string>>();
  for (const table of tables) {
    const deps = new Set<string>();
    for (const target of table.references) {
      if (target === table.name) {
        continue;
      }
      if (!known.has(target)) {
        // Une cible d'un autre connecteur vit dans une AUTRE base : la
        // contrainte ne peut pas exister, et la nommer vaut mieux que la taire.
        omitted.push({ table: table.name, target, reason: "absent" });
        continue;
      }
      deps.add(target);
    }
    dependencies.set(table.name, deps);
  }

  const order: string[] = [];
  const placed = new Set<string>();
  const remaining = new Set(known);
  for (;;) {
    const ready = [...remaining]
      .filter((name) => {
        const deps = dependencies.get(name);
        return !deps || [...deps].every((dep) => placed.has(dep));
      })
      .sort();
    if (ready.length === 0) {
      break;
    }
    for (const name of ready) {
      order.push(name);
      placed.add(name);
      remaining.delete(name);
    }
  }

  // Ce qui reste appartient à un cycle. On le pose quand même, dans un ordre
  // stable, et chaque contrainte encore insatisfaite est abandonnée.
  for (const name of [...remaining].sort()) {
    order.push(name);
    placed.add(name);
  }
  const rank = new Map(order.map((name, index) => [name, index]));
  for (const name of order) {
    for (const target of dependencies.get(name) ?? []) {
      if ((rank.get(target) ?? 0) > (rank.get(name) ?? 0)) {
        omitted.push({ table: name, target, reason: "cycle" });
      }
    }
  }

  return { order, omitted };
}

/**
 * Met en mots les contraintes abandonnées — le message que l'appelant journalise.
 *
 * Écrit pour être lu par celui qui découvre le problème dans ses journaux : il
 * nomme les tables, la cause, et ce qu'il reste à faire. Un avertissement qui ne
 * dit pas quoi faire se relit deux fois puis s'ignore.
 *
 * @param omitted - les contraintes non émises.
 * @returns le texte à journaliser, ou `null` s'il n'y a rien à dire.
 */
export function explainOmittedForeignKeys(
  omitted: readonly IOmittedForeignKey[],
): string | null {
  if (omitted.length === 0) {
    return null;
  }
  const cycles = omitted.filter((entry) => entry.reason === "cycle");
  const absent = omitted.filter((entry) => entry.reason === "absent");
  const parts: string[] = [];
  if (cycles.length > 0) {
    parts.push(
      `cycle entre entités — contrainte(s) NON posée(s) : ` +
        `${cycles.map((c) => `${c.table} → ${c.target}`).join(", ")}. ` +
        `Aucun ordre de création ne satisfait les deux sens ; une migration ` +
        `(\`orm:generate\`) les ajoute après coup par \`ALTER TABLE\`.`,
    );
  }
  if (absent.length > 0) {
    parts.push(
      `cible hors de cette base — contrainte(s) NON posée(s) : ` +
        `${absent.map((a) => `${a.table} → ${a.target}`).join(", ")}. ` +
        `L'entité visée est déclarée sur un autre connecteur : l'intégrité ` +
        `référentielle ne traverse pas deux bases.`,
    );
  }
  return parts.join(" ");
}
