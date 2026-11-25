/**
 * Les plages de version qu'une montée de Nodefony aligne dans le `package.json`
 * d'une application : celles du FRAMEWORK, toutes à la même version, surcharges
 * comprises, et celles de l'OUTILLAGE que le gabarit livré déclare, relevées à
 * son plancher sans jamais descendre.
 *
 * Une règle par sujet, servie aux deux usages : `upgrade --check` la lit pour
 * dire ce qui est en retard, `upgrade --to` l'applique pour l'écrire. Écrite
 * deux fois, elle divergerait : `--check` annoncerait un retard que `--to` ne
 * corrigerait pas.
 *
 * Seule une plage semver se réécrit. `workspace:`, `file:`, `npm:`, une
 * référence `$paquet` d'`overrides` ou `*` disent un choix de l'application
 * (lien local, alias, renvoi, « n'importe laquelle ») : elles restent telles
 * quelles.
 */
import semver from "semver";
import { isPlainObject } from "../runtime/isPlainObject";

/** Une plage à réécrire — ou réécrite — dans le `package.json` d'une application. */
export interface IRangeChange {
  /** Champ du manifeste : `dependencies`, `overrides`, `pnpm.overrides`… */
  readonly field: string;
  /** Clé dans ce champ ; une surcharge imbriquée porte son chemin (`a > b`). */
  readonly name: string;
  /** Plage lue. */
  readonly from: string;
  /** Plage visée. */
  readonly to: string;
}

/** Les blocs où l'application déclare ce qu'elle installe. */
const DECLARED_BLOCKS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

/**
 * Les champs de surcharge, lus récursivement : `overrides` (npm),
 * `resolutions` (yarn), `pnpm.overrides` (pnpm).
 */
const OVERRIDE_FIELDS: readonly (readonly string[])[] = [
  ["overrides"],
  ["resolutions"],
  ["pnpm", "overrides"],
];

/** Les plages qui acceptent n'importe quelle version : un choix, jamais un retard. */
const ANY_RANGE: ReadonlySet<string> = new Set(["", "*", "x", "X"]);

/**
 * Outillage du gabarit que la montée laisse à l'application.
 *
 * `typescript` : les vérificateurs de composants (`vue-tsc`, `svelte-check`)
 * exigent `^5 || ^6`, et la vérification de types passe par `tsgo` — une
 * majeure de TypeScript reste une décision de l'application.
 */
export const TOOLING_LEFT_TO_APP: ReadonlySet<string> = new Set(["typescript"]);

/**
 * Le paquet est-il un paquet du framework (`nodefony`, `@nodefony/*`) ?
 *
 * @param name - nom npm du paquet.
 * @returns `true` pour un paquet verrouillé sur la version du framework.
 */
export function isFrameworkPackage(name: string): boolean {
  return name === "nodefony" || name.startsWith("@nodefony/");
}

/**
 * Le paquet que vise une clé de surcharge : `@nodefony/http`,
 * `**\/@nodefony/http` (yarn), `parent/@nodefony/http`, `@nodefony/http@^10`
 * (npm). Le dernier segment fait foi, avec sa portée s'il en a une.
 *
 * @param key - clé lue dans `overrides`, `resolutions` ou un bloc de dépendances.
 * @returns le nom du paquet visé.
 */
export function packageOfKey(key: string): string {
  const parts = key.split("/");
  let last = parts.at(-1) ?? "";
  const at = last.indexOf("@");
  if (at > 0) last = last.slice(0, at);
  const scope = parts.length >= 2 ? (parts.at(-2) ?? "") : "";
  return scope.startsWith("@") ? `${scope}/${last}` : last;
}

/**
 * Le plancher d'une plage semver — `null` pour ce qui n'en est pas une, ou
 * accepte tout.
 *
 * @param range - valeur lue dans le manifeste.
 * @returns la plus petite version acceptée, ou `null`.
 */
function floorOf(range: string): semver.SemVer | null {
  if (ANY_RANGE.has(range.trim()) || semver.validRange(range) === null) {
    return null;
  }
  return semver.minVersion(range);
}

/**
 * La plage alignée sur `version`, dans la forme que l'application avait
 * choisie : une version épinglée le reste, toute autre plage devient `^version`.
 * `null` quand la valeur n'est pas une plage, ou vise déjà `version`.
 *
 * @param value - plage lue.
 * @param version - version du framework visée.
 * @returns la nouvelle plage, ou `null` s'il n'y a rien à écrire.
 */
function alignedRange(value: string, version: string): string | null {
  const floor = floorOf(value);
  if (floor === null || semver.eq(floor, version)) return null;
  return semver.valid(value) !== null ? version : `^${version}`;
}

/**
 * Parcourt un champ de surcharge, imbrications comprises.
 *
 * Dans `overrides`, un objet porte les surcharges d'un paquet, et sa clé `.`
 * désigne le paquet lui-même : `{ "@nodefony/http": { ".": "^10.0.2" } }`.
 */
function visitOverrides(
  record: Record<string, unknown>,
  field: string,
  path: string,
  owner: string,
  version: string,
  apply: boolean,
  changes: IRangeChange[],
): void {
  for (const [key, value] of Object.entries(record)) {
    const name = path === "" ? key : `${path} > ${key}`;
    const target = key === "." ? owner : packageOfKey(key);
    if (isPlainObject(value)) {
      visitOverrides(value, field, name, target, version, apply, changes);
      continue;
    }
    if (typeof value !== "string" || !isFrameworkPackage(target)) continue;
    const to = alignedRange(value, version);
    if (to === null) continue;
    changes.push({ field, name, from: value, to });
    if (apply) record[key] = to;
  }
}

/**
 * Les plages du framework qui ne visent pas `version` — dépendances,
 * dépendances de développement et surcharges.
 *
 * « Viser » se lit au plancher de la plage : `^10.0.0-beta.6` vise la
 * beta.6, même si elle accepterait la 10.0.2 — et un verrou existant la
 * garderait sur la beta.6. C'est le retard qu'une surcharge écrite en dur
 * cachait.
 *
 * @param data - contenu parsé du `package.json`, réécrit en place si `apply`.
 * @param version - version du framework visée.
 * @param apply - `true` : écrire les plages alignées dans `data`.
 * @returns les plages en retard (ou réécrites), dans l'ordre du manifeste.
 */
export function frameworkRangeChanges(
  data: Record<string, unknown>,
  version: string,
  apply: boolean,
): IRangeChange[] {
  const changes: IRangeChange[] = [];
  for (const block of DECLARED_BLOCKS) {
    const record = data[block];
    if (!isPlainObject(record)) continue;
    for (const [name, value] of Object.entries(record)) {
      if (typeof value !== "string" || !isFrameworkPackage(name)) continue;
      const to = alignedRange(value, version);
      if (to === null) continue;
      changes.push({ field: block, name, from: value, to });
      if (apply) record[name] = to;
    }
  }
  for (const segments of OVERRIDE_FIELDS) {
    let record: unknown = data;
    for (const segment of segments) {
      record = isPlainObject(record) ? record[segment] : undefined;
    }
    if (!isPlainObject(record)) continue;
    visitOverrides(record, segments.join("."), "", "", version, apply, changes);
  }
  return changes;
}

/**
 * L'outillage du gabarit livré que l'application déclare SOUS son plancher.
 *
 * Seuls les paquets déjà déclarés comptent — la montée n'en ajoute aucun —, et
 * une plage plus haute dans l'application est gardée : rien ne descend. Une
 * version épinglée sous le plancher (`better-sqlite3` à `13.0.3`) se réécrit :
 * aucune mise à jour ne la bougerait. Pas `npm update` : il monterait aussi les
 * dépendances métier de l'application, que le framework ne possède pas.
 *
 * @param data - contenu parsé du `package.json`, réécrit en place si `apply`.
 * @param floors - plages du gabarit livré (`SCAFFOLD_VERSIONS`).
 * @param apply - `true` : écrire les plages relevées dans `data`.
 * @returns les plages sous leur plancher (ou relevées).
 */
export function toolingRangeChanges(
  data: Record<string, unknown>,
  floors: Readonly<Record<string, string>>,
  apply: boolean,
): IRangeChange[] {
  const changes: IRangeChange[] = [];
  for (const block of DECLARED_BLOCKS) {
    const record = data[block];
    if (!isPlainObject(record)) continue;
    for (const [name, value] of Object.entries(record)) {
      if (typeof value !== "string" || TOOLING_LEFT_TO_APP.has(name)) continue;
      const template = Object.hasOwn(floors, name) ? floors[name] : undefined;
      if (template === undefined) continue;
      const have = floorOf(value);
      const want = floorOf(template);
      if (have === null || want === null || !semver.lt(have, want)) continue;
      changes.push({ field: block, name, from: value, to: template });
      if (apply) record[name] = template;
    }
  }
  return changes;
}
