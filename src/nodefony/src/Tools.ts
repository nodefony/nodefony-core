/* eslint-disable @typescript-eslint/no-explicit-any */
import Container from "./Container";

// ─── Cached references (évite les lookups prototypiques répétés) ─────────────

const ObjProto = Object.prototype;
const _toString = ObjProto.toString; // explicite — ne dépend plus du global toString
const hasOwn = ObjProto.hasOwnProperty;
const fnToString = hasOwn.toString;
const ObjectFunctionString = fnToString.call(Object);
const getProto = Object.getPrototypeOf;

// ─── Natif — suppression des dépendances lodash-es ───────────────────────────

/** Alias direct de `Array.isArray` — exporté pour usage cohérent dans les modules. */
const isArray = Array.isArray;

/**
 * Type guard — `true` si `value` est une fonction (incluant arrow et classes).
 *
 * @param value - valeur inconnue à tester.
 */
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

/**
 * Type guard — `true` si `value` est une instance `RegExp`.
 *
 * @param value - valeur inconnue à tester.
 */
const isRegExp = (value: unknown): value is RegExp => value instanceof RegExp;

// ─── isPlainObject ────────────────────────────────────────────────────────────

/**
 * Vérifie qu'un objet est un "plain object" — `{}` ou `Object.create(null)`.
 *
 * Rejette les instances de classes, les `Array`, `Date`, `RegExp`, etc.
 * Implémentation alignée sur jQuery.isPlainObject (compatible cross-realm).
 *
 * @param obj - valeur à tester.
 * @returns `true` si l'objet vient directement de `Object` ou n'a pas de prototype.
 */
const isPlainObject = (obj: unknown): boolean => {
  if (!obj || _toString.call(obj) !== "[object Object]") return false;
  const proto = getProto(obj);
  if (!proto) return true; // Object.create(null)
  const Ctor = hasOwn.call(proto, "constructor") && (proto as any).constructor;
  return (
    typeof Ctor === "function" && fnToString.call(Ctor) === ObjectFunctionString
  );
};

// ─── isUndefined / isEmptyObject ─────────────────────────────────────────────

/**
 * Type guard — `true` si `value === undefined` (strict, jamais `null`).
 *
 * @param value - valeur à tester.
 */
const isUndefined = (value: unknown): value is undefined => value === undefined;

/**
 * Vérifie qu'un objet existe et ne contient aucune clé propre énumérable.
 *
 * @param obj - objet à inspecter (peut être `null`/`undefined`).
 * @returns `true` si `obj` est défini ET `Object.keys(obj).length === 0`.
 */
const isEmptyObject = (obj: object | null | undefined): boolean =>
  !!obj && Object.keys(obj).length === 0;

// ─── extend ───────────────────────────────────────────────────────────────────
//
// API jQuery-compatible : extend(target, ...sources) ou extend(true, target, ...sources)
//
// Améliorations vs version précédente :
//   • hasOwn.call() — only own enumerable props, évite la pollution héritée
//   • Guard étendu : __proto__ + constructor + prototype
//   • isPlainObject/isArray inline sans lodash
//   • _toString explicitement référencé (plus de dépendance au global toString)

/**
 * Fusionne plusieurs objets dans une cible — API compatible `jQuery.extend`.
 *
 * Mode `shallow` (défaut) : copie les clés du dernier au premier source.
 * Mode `deep` (1er arg `true`) : récurse dans les plain objects et arrays.
 * Sécurité : ignore `__proto__`, `constructor`, `prototype` (anti prototype pollution).
 *
 * @param args - `[target, ...sources]` ou `[true, target, ...sources]` pour deep.
 * @returns la cible mutée (ou objet vide si appel à un seul argument).
 *
 * @example
 * ```ts
 * extend({ a: 1 }, { b: 2 });               // { a: 1, b: 2 }
 * extend(true, { a: { x: 1 } }, { a: { y: 2 } }); // { a: { x: 1, y: 2 } }
 * ```
 */
const extend = (...args: any[]): any => {
  let options: any,
    name: string,
    src: any,
    copy: any,
    copyIsArray = false,
    clone: any,
    target: any = args[0] || {},
    i = 1,
    deep = false;
  const { length } = args;

  if (typeof target === "boolean") {
    deep = target;
    target = args[i] || {};
    i++;
  }

  if (typeof target !== "object" && typeof target !== "function") {
    target = {};
  }

  // Argument unique : renvoie une copie de la source dans un objet vierge
  if (i === length) {
    target = {};
    i--;
  }

  for (; i < length; i++) {
    if ((options = args[i]) != null) {
      for (name in options) {
        // Propriétés propres uniquement — évite l'héritage énumérable parasite
        if (!hasOwn.call(options, name)) continue;

        copy = options[name];

        // Prototype pollution guard + référence circulaire
        if (
          name === "__proto__" ||
          name === "constructor" ||
          name === "prototype" ||
          target === copy
        )
          continue;

        if (
          deep &&
          copy &&
          (isPlainObject(copy) || (copyIsArray = isArray(copy)))
        ) {
          src = target[name];

          if (copyIsArray && !isArray(src)) {
            clone = [];
          } else if (!copyIsArray && !isPlainObject(src)) {
            clone = {};
          } else {
            clone = src;
          }
          copyIsArray = false;

          target[name] = extend(deep, clone, copy);
        } else if (copy !== undefined) {
          target[name] = copy;
        }
      }
    }
  }

  return target;
};

// ─── typeOf ───────────────────────────────────────────────────────────────────

/**
 * Détecte le type runtime d'une valeur — extension typée de `typeof`.
 *
 * Retourne `"buffer" | "array" | "date" | "RegExp" | "arguments" | "SyntaxError" | "Error"`
 * pour les objets connus, sinon le `typeof` natif. `null` pour `null`.
 *
 * @param value - valeur quelconque à classifier.
 * @returns string descriptive du type, ou `null` si valeur `null`.
 *
 * @example
 * ```ts
 * typeOf([]);              // "array"
 * typeOf(new Date());      // "date"
 * typeOf(Buffer.alloc(0)); // "buffer"
 * typeOf(null);            // null
 * ```
 */
// `Buffer` n'existe pas en navigateur (Core isomorphe) — accès via globalThis
// pour compiler sous tsconfigClient `types: []`. undefined côté browser → skip.
const _gBuffer = (globalThis as { Buffer?: { isBuffer(v: unknown): boolean } })
  .Buffer;

const typeOf = (value: any): string | null => {
  const t = typeof value;
  if (t === "object") {
    if (value === null) return null;
    if (_gBuffer?.isBuffer(value)) return "buffer";
    if (isArray(value)) return "array";
    if (value instanceof Date) return "date";
    if (isRegExp(value)) return "RegExp";
    // `value.callee` est INTERDIT en strict mode (poison-pill sur un objet
    // `arguments` non-mappé → TypeError). Détection strict-safe via la balise
    // interne, qui ne touche aucune propriété piégée.
    if (Object.prototype.toString.call(value) === "[object Arguments]")
      return "arguments";
    if (value instanceof SyntaxError) return "SyntaxError";
    if (isError(value)) return "Error";
  } else if (t === "function" && typeof value.call === "undefined") {
    return "object";
  }
  return t;
};

// ─── Utilitaires conteneur / promesse / erreur ────────────────────────────────

/**
 * Type guard — `true` si la valeur est une instance de `Container` (DI).
 *
 * @param container - valeur à tester.
 */
const isContainer = (container: unknown): container is Container =>
  container instanceof Container;

/**
 * Type guard — `true` si la valeur est une instance d'`Error` natif.
 *
 * @param it - valeur à tester.
 */
const isError = (it: unknown): it is Error => it instanceof Error;

/**
 * Vérifie qu'une valeur est une `Promise` ou un thenable (duck-typing `.then`).
 *
 * Accepte les promesses natives ET les bibliothèques tierces (Bluebird, etc.)
 * qui implémentent le protocole Promises/A+.
 *
 * @param obj - valeur à tester.
 * @returns `true` si `obj instanceof Promise` ou `typeof obj.then === "function"`.
 */
const isPromise = (obj: any): boolean => {
  if (obj instanceof Promise) return true;
  return (
    Boolean(obj) &&
    (typeof obj === "object" || typeof obj === "function") &&
    typeof obj.then === "function"
  );
};

/**
 * Vérifie qu'une classe hérite (directement ou non) d'une autre.
 *
 * @param subclass - classe enfant supposée.
 * @param superclass - classe parent attendue.
 * @returns `true` si `subclass.prototype instanceof superclass`.
 */
const isSubclassOf = (subclass: any, superclass: any): boolean =>
  subclass.prototype instanceof superclass;

/** Code de caractère de `/`. */
const SLASH = 47;

/**
 * Retire les barres obliques finales d'une chaîne, sans expression régulière.
 *
 * **Pourquoi pas `value.replace(/\/+$/, "")`** — la forme évidente, et celle qui
 * était recopiée à cinq endroits. Elle est QUADRATIQUE quand la reconnaissance
 * ÉCHOUE : le moteur reprend l'essai à chaque position, consomme la suite des
 * barres, puis bute sur l'ancre de fin. Mesuré sur des barres suivies d'un
 * caractère quelconque — 1 000 → 1,4 ms, 4 000 → 21 ms, 16 000 → **309 ms** ;
 * la même entrée passe ici en 0 ms. Le cas qui RÉUSSIT, lui, coûte 0,03 ms :
 * c'est l'échec qui est cher, et c'est le cas qu'une entrée hostile provoque.
 *
 * Deux propriétés utiles en chemin chaud : la lecture est en O(n) sans retour
 * arrière, et **rien n'est alloué** quand il n'y a rien à couper — la chaîne
 * d'origine est rendue telle quelle, là où `replace` alloue à chaque appel.
 *
 * @param value - la chaîne à normaliser (typiquement un chemin ou une URL).
 * @returns la chaîne sans ses barres obliques finales ; la chaîne elle-même si elle n'en avait pas.
 */
const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
};

/** Métacaractères d'expression régulière — tous ceux qui changent le SENS d'un motif. */
const REG_METACHARACTERS = /[.*+?^${}()|[\]\\]/gu;

/**
 * Neutralise les métacaractères d'une chaîne destinée à être insérée dans une
 * expression régulière, pour qu'elle n'y vaille que pour elle-même.
 *
 * **Pourquoi c'est ici** — le même motif était recopié à sept endroits, dans
 * cinq paquets. Une liste de caractères recopiée est une liste qui diverge : il
 * suffit qu'une copie oublie `|` pour qu'un littéral cesse d'être un littéral.
 * `|` est d'ailleurs le plus coûteux à omettre, parce qu'il ne fait pas
 * qu'élargir la reconnaissance : il DÉSANCRE. `new RegExp("^/a|b$")` ne
 * reconnaît pas « /a ou /b » — il reconnaît « commence par /a » **ou** « finit
 * par b », donc `/n/importe/quoi/b`.
 *
 * @param value - la chaîne à traiter comme un littéral.
 * @returns la même chaîne, chaque métacaractère précédé d'une barre inverse.
 */
const escapeRegExp = (value: string): string =>
  value.replace(REG_METACHARACTERS, "\\$&");

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise,
  isSubclassOf,
  stripTrailingSlashes,
  escapeRegExp,
};
