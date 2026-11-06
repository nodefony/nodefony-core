/**
 * Lecture des `overrides` npm de la racine : une dépendance qu'un tiers déclare
 * est-elle FORCÉE par nous ?
 *
 * Sans cette lecture, le constat « se DÉDOUBLERAIT » de `check-deps-latest.mjs`
 * accusait `@angular/build` d'exiger `vite 8.3.5` alors que la racine le force
 * déjà (`"@angular/build": { "vite": "$vite" }`) : l'outil déconseillait une
 * montée que le dépôt avait rendue sûre, et l'on finissait par ne plus le lire.
 */

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
