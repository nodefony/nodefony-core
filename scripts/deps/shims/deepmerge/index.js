/**
 * deepmerge 4.3.1 (MIT, Josh Duff — `license.txt`), à l'identique, plus UNE
 * garde : les clés `__proto__`, `constructor` et `prototype` ne sont jamais
 * écrites dans l'objet rendu.
 *
 * Pourquoi un shim : toutes les versions publiées (≤ 4.3.1) laissent une source
 * poser `__proto__` sur l'objet fusionné (GHSA-gcqx-w48m-w2h4), et aucune
 * version corrigée n'existe. La garde d'origine (`propertyIsUnsafe`) ne mord que
 * si la CIBLE est un objet ordinaire : une cible primitive ou sans prototype
 * (`Object.create(null)`) laissait passer l'affectation. Seul consommateur dans
 * le dépôt : `@sveltejs/vite-plugin-svelte` (fusion de sa config). Branché par
 * `overrides.deepmerge` du `package.json` racine. À retirer dès qu'une version
 * amont corrigée paraît : `npm run deps:gate` (CI) rougit le jour où l'amont
 * publie au-dessus de la base du shim.
 *
 * @usage "overrides": { "deepmerge": "$deepmerge" }  // package.json racine, avec devDependencies.deepmerge = "file:scripts/deps/shims/deepmerge"
 * @module deepmerge
 */

/** Clés qui, écrites par affectation, touchent au prototype de l'objet rendu. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const canUseSymbol = typeof Symbol === "function" && Symbol.for;
const REACT_ELEMENT_TYPE = canUseSymbol ? Symbol.for("react.element") : 0xeac7;

function isNonNullObject(value) {
  return !!value && typeof value === "object";
}

function isReactElement(value) {
  return value.$$typeof === REACT_ELEMENT_TYPE;
}

function isSpecial(value) {
  const stringValue = Object.prototype.toString.call(value);
  return (
    stringValue === "[object RegExp]" ||
    stringValue === "[object Date]" ||
    isReactElement(value)
  );
}

function isMergeableObject(value) {
  return isNonNullObject(value) && !isSpecial(value);
}

function emptyTarget(val) {
  return Array.isArray(val) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(emptyTarget(value), value, options)
    : value;
}

function defaultArrayMerge(target, source, options) {
  return target
    .concat(source)
    .map((element) => cloneUnlessOtherwiseSpecified(element, options));
}

function getMergeFunction(key, options) {
  if (!options.customMerge) return deepmerge;
  const customMerge = options.customMerge(key);
  return typeof customMerge === "function" ? customMerge : deepmerge;
}

function getEnumerableOwnPropertySymbols(target) {
  return Object.getOwnPropertySymbols(target).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(target, symbol),
  );
}

/** Clés énumérables propres (chaînes puis symboles), clés interdites retirées. */
function getKeys(target) {
  return Object.keys(target)
    .filter((key) => !FORBIDDEN_KEYS.has(key))
    .concat(getEnumerableOwnPropertySymbols(target));
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch {
    return false;
  }
}

// Protège de la fusion le long de la chaîne de prototypes (garde d'origine).
function propertyIsUnsafe(target, key) {
  return (
    propertyIsOnObject(target, key) &&
    !(
      Object.prototype.hasOwnProperty.call(target, key) &&
      Object.prototype.propertyIsEnumerable.call(target, key)
    )
  );
}

function mergeObject(target, source, options) {
  const destination = {};
  if (options.isMergeableObject(target)) {
    for (const key of getKeys(target)) {
      destination[key] = cloneUnlessOtherwiseSpecified(target[key], options);
    }
  }
  for (const key of getKeys(source)) {
    if (propertyIsUnsafe(target, key)) continue;
    if (
      propertyIsOnObject(target, key) &&
      options.isMergeableObject(source[key])
    ) {
      destination[key] = getMergeFunction(key, options)(
        target[key],
        source[key],
        options,
      );
    } else {
      destination[key] = cloneUnlessOtherwiseSpecified(source[key], options);
    }
  }
  return destination;
}

/**
 * Fusionne récursivement `source` dans une COPIE de `target` (API de deepmerge 4).
 *
 * @param target - valeur de départ, jamais modifiée.
 * @param source - valeur fusionnée par-dessus.
 * @param options - `arrayMerge`, `isMergeableObject`, `customMerge`, `clone`.
 * @returns la fusion, sans clé `__proto__` / `constructor` / `prototype`.
 */
function deepmerge(target, source, options) {
  options = options || {};
  options.arrayMerge = options.arrayMerge || defaultArrayMerge;
  options.isMergeableObject = options.isMergeableObject || isMergeableObject;
  // Exposé dans `options` pour les `arrayMerge` personnalisés (contrat d'origine).
  options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

  const sourceIsArray = Array.isArray(source);
  const targetIsArray = Array.isArray(target);
  if (sourceIsArray !== targetIsArray) {
    return cloneUnlessOtherwiseSpecified(source, options);
  }
  if (sourceIsArray) return options.arrayMerge(target, source, options);
  return mergeObject(target, source, options);
}

/**
 * Fusionne une liste d'objets, de gauche à droite.
 *
 * @throws Error si `array` n'est pas un tableau (contrat d'origine).
 */
deepmerge.all = function deepmergeAll(array, options) {
  if (!Array.isArray(array)) {
    throw new Error("first argument should be an array");
  }
  return array.reduce((prev, next) => deepmerge(prev, next, options), {});
};

export default deepmerge;
