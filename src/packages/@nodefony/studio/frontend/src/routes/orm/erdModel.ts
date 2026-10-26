/**
 * Modèle PUR du schéma ERD de la console (`routes/Database.tsx`) : types miroirs
 * du graphe servi par `/nodefony/orm/api/graph`, liens canoniques, colonnes clés,
 * carte des domaines et périmètre d'un domaine. Aucun JSX, aucun import React :
 * la règle se teste sans navigateur (`nodefony/tests/unit/erdModel.test.ts`).
 */

// ── Types miroir du data plane /nodefony/orm/api (graphe canonique) ──────────
export interface ColumnInfo {
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
}
export interface RelationInfo {
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  target: string;
  field: string;
  foreignKey?: string;
}
export interface EntityNode {
  name: string;
  connector: string;
  /** Module Nodefony propriétaire (`""` = non rattaché → groupe « — »). */
  module: string;
  /** Classification (domaine fonctionnel) — axe de regroupement prioritaire si présent. */
  domain: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
}

/**
 * Au-delà de ce nombre de tables, le schéma passe en mode « grand schéma » :
 * boîtes compactes, carte des domaines à l'ouverture, tables sans lien en
 * pastilles. En deçà, l'écran reste celui d'une petite base.
 */
export const LARGE_GRAPH = 60;

/** Valeur de filtre du groupe « non rattaché » (domaine et module vides). */
export const NONE = "·none·";

/**
 * Clé de regroupement ERD : le **domaine** (classification, ex. `facturation`)
 * s'il est renseigné, sinon le **module** (propriété). Permet de subdiviser une
 * grosse base mono-module (un logiciel de gestion : 1 module, 34 domaines).
 */
export const groupKey = (e: EntityNode): string => e.domain || e.module || "";

/** Clé de FILTRE d'une entité : `groupKey`, ou `NONE` pour le groupe vide. */
export const filterKey = (e: EntityNode): string => groupKey(e) || NONE;

/** Nom de colonne de clé étrangère supposé quand la relation n'en déclare pas. */
export const camelFk = (target: string): string =>
  `${target.charAt(0).toLowerCase()}${target.slice(1)}Id`;

/**
 * Un lien du schéma, sous sa forme canonique : une arête par clé étrangère
 * PHYSIQUE, de la table qui la porte vers la table visée — ou une arête non
 * orientée pour un plusieurs-à-plusieurs.
 */
export interface ErdLink {
  id: string;
  source: string;
  target: string;
  kind: "many-to-one" | "one-to-one" | "many-to-many";
}

/**
 * Liens canoniques entre les entités d'un périmètre.
 *
 * Une clé étrangère peut être déclarée des deux côtés (1-N côté source, N-1 côté
 * cible) : chaque relation est ramenée au sens « FK → PK » et dédoublonnée par
 * sa colonne. SEULE règle du comptage : le compteur de l'en-tête, la carte des
 * domaines et le dessin la lisent tous trois.
 *
 * @param entities - le périmètre ; une relation dont la cible n'y est pas est ignorée.
 * @returns les liens, chacun une seule fois.
 */
export function canonicalLinks(entities: readonly EntityNode[]): ErdLink[] {
  const names = new Set(entities.map((e) => e.name));
  const links: ErdLink[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    for (const r of e.relations) {
      if (!names.has(r.target)) continue;
      if (r.type === "many-to-many") {
        const key = [e.name, r.target].sort().join("<>");
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          id: `m2m-${key}`,
          source: e.name,
          target: r.target,
          kind: "many-to-many",
        });
        continue;
      }
      const fkTable = r.type === "one-to-many" ? r.target : e.name;
      const pkTable = r.type === "one-to-many" ? e.name : r.target;
      const fk =
        r.foreignKey ?? camelFk(r.type === "one-to-many" ? e.name : r.target);
      const id = `${fkTable}.${fk}>${pkTable}`;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({
        id,
        source: fkTable,
        target: pkTable,
        kind: r.type === "one-to-one" ? "one-to-one" : "many-to-one",
      });
    }
  }
  return links;
}

/** Noms des entités touchées par au moins un lien. */
export function linkedNames(links: readonly ErdLink[]): Set<string> {
  const s = new Set<string>();
  for (const l of links) s.add(l.source).add(l.target);
  return s;
}

/** Colonnes de clé étrangère PORTÉES par l'entité (côté N-1 et 1-1). */
export function foreignKeyColumns(entity: EntityNode): Set<string> {
  const fk = new Set<string>();
  for (const r of entity.relations) {
    if (r.type === "many-to-one" || r.type === "one-to-one") {
      fk.add(r.foreignKey ?? camelFk(r.target));
    }
  }
  return fk;
}

/**
 * Colonnes d'une boîte compacte : clé primaire et clés étrangères, dans l'ordre
 * de la table. Ce sont elles qui portent les liens dessinés.
 */
export function keyColumns(entity: EntityNode): ColumnInfo[] {
  const fk = foreignKeyColumns(entity);
  return entity.columns.filter((c) => c.primaryKey || fk.has(c.name));
}

/** Un domaine (ou module) sur la carte. */
export interface DomainSummary {
  /** Clé de filtre (`filterKey`). */
  key: string;
  /** Libellé affiché (`—` pour le groupe vide). */
  label: string;
  tables: number;
  /** Tables du domaine qui n'ont aucun lien, ni sortant ni entrant. */
  isolated: number;
}

/** Un lien entre deux domaines : le nombre de clés étrangères qui les relient. */
export interface DomainLink {
  source: string;
  target: string;
  weight: number;
}

/**
 * La carte des domaines : un nœud par groupe, un lien pondéré par paire de
 * groupes reliés. Les liens INTERNES à un domaine ne s'y voient pas.
 *
 * @param entities - tout le schéma du connecteur.
 * @returns domaines triés par taille décroissante, liens triés par poids décroissant.
 */
export function domainMap(entities: readonly EntityNode[]): {
  domains: DomainSummary[];
  links: DomainLink[];
} {
  const links = canonicalLinks(entities);
  const linked = linkedNames(links);
  const keyOf = new Map(entities.map((e) => [e.name, filterKey(e)]));
  const domains = new Map<string, DomainSummary>();
  for (const e of entities) {
    const key = filterKey(e);
    let d = domains.get(key);
    if (!d) {
      d = { key, label: groupKey(e) || "—", tables: 0, isolated: 0 };
      domains.set(key, d);
    }
    d.tables += 1;
    if (!linked.has(e.name)) d.isolated += 1;
  }
  const pairs = new Map<string, DomainLink>();
  for (const l of links) {
    const a = keyOf.get(l.source);
    const b = keyOf.get(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    const [source, target] = a < b ? [a, b] : [b, a];
    const id = `${source}\u0000${target}`;
    const p = pairs.get(id);
    if (p) p.weight += 1;
    else pairs.set(id, { source, target, weight: 1 });
  }
  return {
    domains: [...domains.values()].sort(
      (x, y) => y.tables - x.tables || x.label.localeCompare(y.label),
    ),
    links: [...pairs.values()].sort((x, y) => y.weight - x.weight),
  };
}

/**
 * Le périmètre d'un domaine ouvert : ses tables, et les tables d'AUTRES domaines
 * qu'une clé étrangère relie à l'une d'elles (les « fantômes »). Sans elles, un
 * domaine paraît isolé alors que ses liens partent ailleurs.
 *
 * @param entities - tout le schéma du connecteur.
 * @param key - clé de filtre du domaine (`filterKey`).
 * @returns les membres, et les voisines hors domaine.
 */
export function domainScope(
  entities: readonly EntityNode[],
  key: string,
): { members: EntityNode[]; ghosts: EntityNode[] } {
  const members = entities.filter((e) => filterKey(e) === key);
  const inside = new Set(members.map((e) => e.name));
  const ghostNames = new Set<string>();
  for (const l of canonicalLinks(entities)) {
    if (inside.has(l.source) && !inside.has(l.target)) ghostNames.add(l.target);
    if (inside.has(l.target) && !inside.has(l.source)) ghostNames.add(l.source);
  }
  return {
    members,
    ghosts: entities.filter((e) => ghostNames.has(e.name)),
  };
}
