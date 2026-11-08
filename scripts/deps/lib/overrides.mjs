/**
 * Lecture des `overrides` npm de la racine : une dépendance qu'un tiers déclare
 * est-elle FORCÉE par nous ?
 *
 * Sans cette lecture, le constat « se DÉDOUBLERAIT » de `check-deps-latest.mjs`
 * accusait `@angular/build` d'exiger `vite 8.3.5` alors que la racine le force
 * déjà (`"@angular/build": { "vite": "$vite" }`) : l'outil déconseillait une
 * montée que le dépôt avait rendue sûre, et l'on finissait par ne plus le lire.
 *
 * @usage import { forcedByOverride, overrideBreaches } from "./lib/overrides.mjs"
 */

import semver from "semver";

/**
 * Overrides qui sortent SCIEMMENT de la plage déclarée par leur tiers, au-delà
 * d'un simple correctif — clé `parent>dep`, valeur : le motif. Ce qui n'est pas
 * ici et franchit une mineure ou une majeure fait échouer `deps:gate`.
 *
 * Vécu : `vite → rolldown: $rolldown` imposait rolldown 1.3.0 à vite 8.3.6, qui
 * déclare `~1.2.16`. Le marqueur de préchargement de Vite n'était plus remplacé,
 * et le bundle de production de Studio sortait syntaxiquement invalide — page
 * vide, vue seulement par la sonde navigateur de la forge. Un tiers qui épingle
 * en `~` DIT qu'il ne tient que les correctifs : le forcer au-delà, c'est
 * l'exécuter dans une configuration que personne n'a testée.
 */
export const ACCEPTED_OVERRIDE_BREACHES = {
  "@esbuild-kit/core-utils>esbuild":
    "sécurité — écarte la version d'esbuild signalée par Dependabot",
};

/**
 * Confronte chaque override IMBRIQUÉ (`"parent": { "dep": spec }`) à la plage
 * que `parent` déclare pour `dep`, et rend ce qui en sort.
 *
 * Verdicts : `correctif` (même mineure, accepté d'office — semver promet la
 * compatibilité), `accepté` (inscrit dans `accepted`, avec son motif),
 * `HORS-PLAGE` (franchit une mineure ou une majeure sans motif : fatal),
 * `MORT` (le parent ne déclare plus `dep` : l'override ne force plus rien),
 * `EXCEPTION-SANS-OBJET` (une entrée de `accepted` ne couvre plus aucun
 * dépassement : le tiers a rattrapé, ou l'override est parti — la retirer).
 * Un override dans la plage ne rend rien : il sert à dédoublonner, c'est sain.
 * La forme globale (`"dep": spec`) n'est pas confrontée : elle vaut pour tous
 * les consommateurs, et chacun déclare sa plage.
 *
 * @param {Record<string, unknown> | undefined} overrides - champ `overrides` de la racine
 * @param {{ rootVersion: (name: string) => string | null, declared: (parent: string) => { version: string, deps: Record<string, string> } | null }} read
 *   `rootVersion` : version installée d'une dépendance directe (résout `$dep`) ;
 *   `declared` : version installée de `parent` et ses dépendances déclarées, ou `null` s'il n'est pas installé.
 * @param {Record<string, string>} [accepted] - exceptions motivées, clé `parent>dep`
 * @returns {Array<{ key: string, parent: string, parentVersion?: string, dep?: string, declared?: string, forced?: string, verdict: string, reason?: string }>}
 */
export function overrideBreaches(
  overrides,
  read,
  accepted = ACCEPTED_OVERRIDE_BREACHES,
) {
  const out = [];
  const covered = new Set();
  for (const [key, val] of Object.entries(overrides ?? {})) {
    if (val === null || typeof val !== "object") continue;
    const parent = keyName(key);
    const info = read.declared(parent);
    if (info === null) continue; // non installé : rien à confronter
    for (const [k, v] of Object.entries(val)) {
      const dep = keyName(k);
      const spec = typeof v === "string" ? v : v?.["."];
      if (typeof spec !== "string") continue;
      const forced = spec.startsWith("$")
        ? read.rootVersion(spec.slice(1))
        : spec;
      const pair = `${parent}>${dep}`;
      const base = { key: pair, parent, parentVersion: info.version, dep };
      const declared = info.deps[dep];
      if (declared === undefined) {
        out.push({ ...base, forced: forced ?? spec, verdict: "MORT" });
        continue;
      }
      if (forced === null || !semver.validRange(declared)) continue;
      const exact = semver.valid(forced);
      const inRange = exact
        ? semver.satisfies(forced, declared, { includePrerelease: true })
        : semver.intersects(forced, declared);
      if (inRange) continue;
      const floor = semver.minVersion(declared);
      const patchOnly =
        exact !== null &&
        floor !== null &&
        semver.major(exact) === floor.major &&
        semver.minor(exact) === floor.minor;
      const entry = { ...base, declared, forced };
      if (patchOnly) out.push({ ...entry, verdict: "correctif" });
      else if (Object.hasOwn(accepted, pair)) {
        covered.add(pair);
        out.push({ ...entry, verdict: "accepté", reason: accepted[pair] });
      } else out.push({ ...entry, verdict: "HORS-PLAGE" });
    }
  }
  // Une exception ne se juge que si son tiers est installé — même règle que
  // les overrides : un décor qui ne l'installe pas n'en dit rien.
  for (const [pair, reason] of Object.entries(accepted))
    if (!covered.has(pair) && read.declared(pair.split(">")[0]) !== null)
      out.push({
        key: pair,
        parent: pair.split(">")[0],
        verdict: "EXCEPTION-SANS-OBJET",
        reason,
      });
  return out;
}

/**
 * Nom d'une clé d'`overrides` sans sa plage : `"vite@^8"` → `"vite"`,
 * `"@scope/x@1"` → `"@scope/x"`.
 *
 * @param {string} key
 * @returns {string}
 */
function keyName(key) {
  const at = key.indexOf("@", 1);
  return at === -1 ? key : key.slice(0, at);
}

/**
 * Version que les `overrides` de la racine imposent à `dep` quand c'est
 * `parent` qui la déclare, ou `null` si rien ne la force.
 *
 * Deux formes : globale (`"dep": "x"`, vaut pour tout l'arbre) et imbriquée
 * (`"parent": { "dep": "x" }`, vaut pour le sous-arbre de `parent`). Une valeur
 * `$dep` renvoie à la dépendance directe de la racine : elle est rendue telle
 * quelle, c'est à l'appelant de la résoudre.
 *
 * @param {Record<string, unknown> | undefined} overrides - champ `overrides` de la racine
 * @param {string} parent - paquet installé qui déclare la dépendance
 * @param {string} dep - dépendance déclarée
 * @returns {string | null}
 */
export function forcedByOverride(overrides, parent, dep) {
  if (!overrides) return null;
  let global = null;
  for (const [key, val] of Object.entries(overrides)) {
    const name = keyName(key);
    if (name === parent && val !== null && typeof val === "object") {
      for (const [k, v] of Object.entries(val))
        if (keyName(k) === dep) {
          if (typeof v === "string") return v;
          if (v !== null && typeof v === "object" && typeof v["."] === "string")
            return v["."];
        }
    } else if (name === dep) {
      if (typeof val === "string") global = val;
      else if (
        val !== null &&
        typeof val === "object" &&
        typeof val["."] === "string"
      )
        global = val["."];
    }
  }
  return global;
}
