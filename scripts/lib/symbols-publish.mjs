/**
 * Graphe symbolique : à quel module appartient un fichier, quels modules sont
 * PUBLIÉS, et la copie du graphe réduite à eux — seule implémentation.
 *
 * Le graphe du dépôt décrit TOUT ce qui s'y écrit : les modules de banc
 * (`modules/test`, les `test-frontend-*`), les paquets privés en chantier. La
 * copie empaquetée dans `nodefony` ne doit décrire que ce qu'un utilisateur
 * peut installer — sinon une application lit des symboles de modules qu'elle
 * n'aura jamais (173 mesurés avant ce filtre).
 *
 * Module pur, sans effet à l'import : `generate-symbols.ts` l'emploie, les tests
 * l'éprouvent sans lancer de génération.
 *
 * @usage import { moduleOf, publishedModules, filterGraphToModules } from "../lib/symbols-publish.mjs"
 */
import { execSync } from "node:child_process";

/**
 * Le module qui porte un fichier, d'après son chemin relatif à la racine du
 * dépôt (séparateur `/`).
 *
 * @param {string} relativeFile - ex. `src/packages/@nodefony/http/index.ts`
 * @returns {string} `@nodefony/http`, `modules/test`, `@nodefony/core` ou `unknown`
 */
export function moduleOf(relativeFile) {
  const pkgMatch = relativeFile.match(/^src\/packages\/(@nodefony\/[^/]+)/);
  if (pkgMatch?.[1]) return pkgMatch[1];
  const modMatch = relativeFile.match(/^src\/modules\/([^/]+)/);
  if (modMatch) return `modules/${modMatch[1]}`;
  if (relativeFile.startsWith("src/nodefony/")) return "@nodefony/core";
  return "unknown";
}

/**
 * Les workspaces publiables, résolus par npm — la même source que l'empaquetage
 * (`scripts/release/pack-all.mjs`), jamais une liste écrite à la main.
 *
 * @param {string} root - racine du dépôt
 * @returns {Array<{ name: string, location: string }>}
 */
export function publishableWorkspaces(root) {
  /** @type {Array<{ name: string, location: string, private?: boolean }>} */
  const all = JSON.parse(
    execSync("npm query .workspace --json", { cwd: root, encoding: "utf8" }),
  );
  return all.filter((w) => !w.private);
}

/**
 * Les noms de module (au sens de {@link moduleOf}) des workspaces publiables.
 *
 * @param {Array<{ location: string }>} workspaces
 * @returns {Set<string>}
 */
export function publishedModules(workspaces) {
  return new Set(
    workspaces
      .map((w) => moduleOf(`${w.location.split("\\").join("/")}/`))
      .filter((m) => m !== "unknown"),
  );
}

/**
 * La copie du graphe réduite aux modules donnés : symboles, relations et
 * statistiques recalculés, pour qu'aucune relation ne désigne un absent.
 *
 * Les relations et statistiques sont lues comme des index génériques : le
 * générateur les type par interfaces fermées, que ce module n'a pas à connaître.
 *
 * @template {{ symbols: Record<string, { name: string, module: string, kind: string }>, relations?: object, stats?: object }} G
 * @param {G} graph
 * @param {Set<string>} keep - modules conservés
 * @returns {Omit<G, "symbols" | "relations" | "stats"> & { symbols: G["symbols"], relations: Record<string, Record<string, string[]>>, stats: Record<string, number> }}
 */
export function filterGraphToModules(graph, keep) {
  /** @type {G["symbols"]} */
  const symbols = {};
  for (const [key, sym] of Object.entries(graph.symbols)) {
    if (keep.has(sym.module)) symbols[key] = sym;
  }
  const names = new Set(Object.values(symbols).map((s) => s.name));
  /** @type {Record<string, Record<string, string[]>>} */
  const relations = {};
  const source = /** @type {Record<string, Record<string, string[]>>} */ (
    graph.relations ?? {}
  );
  for (const [kind, index] of Object.entries(source)) {
    /** @type {Record<string, string[]>} */
    const kept = {};
    for (const [target, sources] of Object.entries(index)) {
      // `usedBy` liste des FICHIERS, les autres index des NOMS de symbole.
      const values =
        kind === "usedBy"
          ? sources.filter((f) => keep.has(moduleOf(f)))
          : sources.filter((s) => names.has(s));
      // La CIBLE peut être extérieure au graphe (`extendedBy.EventEmitter`) :
      // elle reste dès qu'un symbole conservé s'y rattache.
      if (values.length) kept[target] = values;
    }
    relations[kind] = kept;
  }
  const kinds = /** @type {Record<string, string>} */ ({
    class: "classes",
    interface: "interfaces",
    type: "types",
    enum: "enums",
    function: "functions",
    "decorator-fn": "functions",
    const: "constants",
  });
  /** @type {Record<string, number>} */
  const stats = {
    .../** @type {Record<string, number> | undefined} */ (graph.stats),
    symbols: 0,
  };
  for (const k of Object.values(kinds)) stats[k] = 0;
  for (const sym of Object.values(symbols)) {
    stats.symbols++;
    const bucket = kinds[sym.kind];
    if (bucket) stats[bucket]++;
  }
  return { ...graph, symbols, relations, stats };
}

/**
 * Les modules d'un graphe qui ne figurent pas dans `allowed` — vide quand la
 * copie publiée ne décrit que ce qui est publié.
 *
 * @param {{ symbols: Record<string, { module: string }> }} graph
 * @param {Set<string>} allowed
 * @returns {string[]}
 */
export function foreignModules(graph, allowed) {
  const out = new Set();
  for (const sym of Object.values(graph.symbols)) {
    if (!allowed.has(sym.module)) out.add(sym.module);
  }
  return [...out].sort();
}
