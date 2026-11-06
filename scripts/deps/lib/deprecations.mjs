/**
 * Dépendances DÉCLARÉES dont la version au verrou est dépréciée en amont.
 *
 * Le document abrégé du registre, que `check-deps-latest.mjs` lit déjà pour
 * les versions, porte aussi le champ `deprecated` de chaque version : le
 * constat ne coûte aucune requête de plus. Vécu : `@types/figlet@1.12.0`,
 * paquet VIDE (« figlet provides its own type definitions ») déclaré par le
 * cœur — `npm outdated` l'affichait « en avance sur latest », rien ne disait
 * qu'il ne servait plus à rien.
 *
 * @usage import { deprecatedInstalled, deprecatedVersionsOf } from "./lib/deprecations.mjs"
 */

/**
 * Relève, parmi les paquets déclarés, les versions installées que l'amont a
 * dépréciées.
 *
 * @param {Iterable<string>} names - paquets déclarés par nos manifestes
 * @param {(name: string) => Iterable<string>} versionsOf - versions au verrou
 * @param {Map<string, Record<string, string>>} deprecated - paquet → { version → message }
 * @returns {{ name: string, version: string, message: string }[]}
 */
export function deprecatedInstalled(names, versionsOf, deprecated) {
  const out = [];
  for (const name of names) {
    const byVersion = deprecated.get(name);
    if (byVersion === undefined) continue;
    for (const version of versionsOf(name)) {
      const message = byVersion[version];
      if (message) out.push({ name, version, message });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Versions dépréciées d'un document abrégé du registre.
 *
 * @param {{ versions?: Record<string, { deprecated?: unknown }> } | null | undefined} body
 * @returns {Record<string, string> | null} version → message, ou `null` si aucune
 */
export function deprecatedVersionsOf(body) {
  let out = null;
  for (const [version, info] of Object.entries(body?.versions ?? {})) {
    const message = info?.deprecated;
    if (typeof message === "string" && message !== "") {
      if (out === null) out = {};
      out[version] = message;
    }
  }
  return out;
}
