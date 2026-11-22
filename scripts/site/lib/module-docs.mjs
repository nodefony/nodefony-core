/**
 * Les modules du dépôt qui portent un dossier `docs/`, et la clé courte qui fait
 * leur adresse sur le site (`/docs/modules/<clé>/`).
 *
 * Une seule règle pour deux lecteurs : le générateur du site, qui publie ces
 * pages, et celui des README, qui y renvoie. Une liste recopiée de l'un à
 * l'autre avait déjà oublié deux modules.
 *
 * @usage import { moduleDocsDirs, moduleDocsUrl } from "./lib/module-docs.mjs"
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Modules qui portent un dossier `docs/`, avec leur clé courte.
 *
 * @param root - racine du dépôt
 * @returns `{ key, npm, dir, label }` par module, le cœur en premier
 */
export function moduleDocsDirs(root) {
  const out = [
    {
      key: "core",
      npm: "nodefony",
      dir: path.join(root, "src", "nodefony", "docs"),
      label: "nodefony (cœur)",
    },
  ];
  const base = path.join(root, "src", "packages", "@nodefony");
  for (const name of readdirSync(base).sort()) {
    const dir = path.join(base, name, "docs");
    if (existsSync(dir))
      out.push({
        key: name,
        npm: `@nodefony/${name}`,
        dir,
        label: `@nodefony/${name}`,
      });
  }
  return out;
}

/**
 * Adresse publique de la documentation d'un paquet, ou `null` s'il n'en a pas.
 *
 * @param root - racine du dépôt
 * @param npmName - nom npm du paquet (`@nodefony/realtime`, `nodefony`)
 * @param siteUrl - adresse du site, sans `/` final
 * @returns `<site>/docs/modules/<clé>/`, ou `null`
 */
export function moduleDocsUrl(root, npmName, siteUrl) {
  const m = moduleDocsDirs(root).find((x) => x.npm === npmName);
  return m === undefined ? null : `${siteUrl}/docs/modules/${m.key}/`;
}
