/* eslint-disable @typescript-eslint/no-explicit-any */
import Container from "./Container";

// ─── Cached references (évite les lookups prototypiques répétés) ─────────────

const ObjProto = Object.prototype;
const FnProto = Function.prototype;
// Appels par `.call` sur les références natives : aucune méthode n'est détachée
// de son objet (explicite — ne dépend plus du global toString).
const _toString = (value: unknown): string => ObjProto.toString.call(value);
const fnToString = (fn: unknown): string => FnProto.toString.call(fn);
const ObjectFunctionString = fnToString(Object);
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
 * @returns `true` si l'objet vient directement de `Object` ou n'a pas de prototype —
 *   ses propriétés se lisent alors typées `unknown`, chacune à vérifier avant usage.
 */
const isPlainObject = (obj: unknown): obj is Record<string, unknown> => {
  if (!obj || _toString(obj) !== "[object Object]") return false;
  const proto = getProto(obj) as object | null;
  if (!proto) return true; // Object.create(null)
  // Raccourci du cas courant — un littéral du realm courant : son constructeur
  // EST `Object`, la comparaison de source ci-dessous rendrait `true`. Elle
  // reste pour les autres realms (`vm`, iframe), et elle coûtait ~240 ns.
  if (proto === ObjProto) return true;
  const Ctor =
    Object.hasOwn(proto, "constructor") &&
    (proto as { constructor?: unknown }).constructor;
  return (
    typeof Ctor === "function" && fnToString(Ctor) === ObjectFunctionString
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
//   • Object.hasOwn() — only own enumerable props, évite la pollution héritée
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
const extend = (...args: unknown[]): any => {
  let target: unknown = args[0] || {},
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

  // Objet ou fonction à ce stade (cf gardes ci-dessus) : indexable par clé.
  const out = target as Record<string, unknown>;

  for (; i < length; i++) {
    const options = args[i];
    if (options != null) {
      const source = options as Record<string, unknown>;
      for (const name in source) {
        // Propriétés propres uniquement — évite l'héritage énumérable parasite
        if (!Object.hasOwn(source, name)) continue;

        const copy = source[name];

        // Prototype pollution guard + référence circulaire
        if (
          name === "__proto__" ||
          name === "constructor" ||
          name === "prototype" ||
          out === copy
        )
          continue;

        let copyIsArray = false;
        if (
          deep &&
          copy &&
          (isPlainObject(copy) || (copyIsArray = isArray(copy)))
        ) {
          const src = out[name];
          let clone: unknown;
          if (copyIsArray && !isArray(src)) {
            clone = [];
          } else if (!copyIsArray && !isPlainObject(src)) {
            clone = {};
          } else {
            clone = src;
          }

          out[name] = extend(deep, clone, copy);
        } else if (copy !== undefined) {
          out[name] = copy;
        }
      }
    }
  }

  return out;
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

const typeOf = (value: unknown): string | null => {
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
  } else if (
    t === "function" &&
    typeof (value as { call?: unknown }).call === "undefined"
  ) {
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
const isPromise = (obj: unknown): obj is PromiseLike<unknown> => {
  if (obj instanceof Promise) return true;
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) {
    return false;
  }
  return "then" in obj && typeof obj.then === "function";
};

/**
 * Une valeur déjà connue, ou la promesse de cette valeur — le type de retour
 * d'une étape qui n'est asynchrone que lorsqu'elle attend réellement (un corps
 * à lire, une base, un hook qui rend une promesse).
 */
type MaybePromise<T> = T | Promise<T>;

/**
 * Enchaîne `onResolved` sur une valeur qui peut être déjà connue ou encore attendue —
 * un `.then` qui reste SYNCHRONE quand il n'y a rien à attendre.
 *
 * Pourquoi pas `await` : un `await` sur une valeur déjà connue crée une
 * Promise, suspend la fonction et reporte la suite d'une micro-tâche, pour un
 * résultat identique. Sur le chemin d'une requête, ces suspensions sans objet
 * se comptaient par dizaines (#505). Ici, `onResolved` est appelé directement quand
 * `value` n'est pas une promesse ; `then` n'intervient que quand elle en est une.
 *
 * Toute valeur « thenable » (duck-typing d'{@link isPromise}) est attendue : une
 * promesse d'une autre bibliothèque est normalisée en Promise native.
 *
 * @param value - la valeur, ou la promesse de cette valeur.
 * @param onResolved - la suite ; elle peut rendre une valeur ou une promesse.
 * @returns le résultat de `onResolved` : synchrone si `value` et `onResolved`
 *   le sont, une Promise sinon.
 * @throws ce que `onResolved` lève, quand `value` était synchrone — sinon
 *   l'erreur devient le rejet de la Promise rendue.
 */
const thenMaybe = <T, U>(
  value: T | PromiseLike<T>,
  onResolved: (resolved: T) => MaybePromise<U>,
): MaybePromise<U> => {
  if (isPromise(value)) {
    // `Promise.resolve` rend la promesse native elle-même (aucune allocation)
    // et n'enveloppe qu'un thenable étranger.
    return (Promise.resolve(value) as Promise<T>).then(onResolved);
  }
  return onResolved(value);
};

/**
 * Exécute `step`, puis `onSettled` quoi qu'il arrive — le `try/finally` d'une
 * étape qui n'est asynchrone que lorsqu'elle attend.
 *
 * `onSettled` part immédiatement après une valeur ou une exception synchrones ;
 * après le règlement (tenu OU rompu) quand `step` rend une promesse. Le
 * résultat, l'exception ou le rejet de `step` sont transmis tels quels.
 *
 * @param step - l'étape à exécuter.
 * @param onSettled - ce qui doit suivre dans tous les cas (fin de phase…).
 * @returns le résultat de `step`, dans la forme où il est venu.
 * @throws ce que `step` lève de façon synchrone, après `onSettled`.
 */
const finallyMaybe = <T>(
  step: () => MaybePromise<T>,
  onSettled: () => void,
): MaybePromise<T> => {
  let result: MaybePromise<T>;
  try {
    result = step();
  } catch (error) {
    onSettled();
    throw error;
  }
  if (isPromise(result)) {
    return (Promise.resolve(result) as Promise<T>).finally(onSettled);
  }
  onSettled();
  return result;
};

/**
 * Vérifie qu'une classe hérite (directement ou non) d'une autre.
 *
 * @param subclass - classe enfant supposée.
 * @param superclass - classe parent attendue.
 * @returns `true` si `subclass.prototype instanceof superclass`.
 */
const isSubclassOf = (subclass: unknown, superclass: any): boolean =>
  // Lecture volontairement NON gardée : `null`/`undefined` lève un TypeError,
  // comme avant (contrat couvert par Tools.test.ts).
  (subclass as { prototype: unknown }).prototype instanceof superclass;

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

/** Un octet décimal BORNÉ (0-255) : `127.999.1.1` n'est pas une adresse. */
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LOOPBACK_V4_RE = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/**
 * Ce nom d'hôte désigne-t-il la boucle locale ? Règle UNIQUE du framework —
 * l'inspecteur de développement, le proxy inverse et le frontend décident
 * tous par elle.
 *
 * `localhost`, `::1` (crochets tolérés) et tout le bloc `127.0.0.0/8`
 * (RFC 1122 §3.2.1.3) — pas seulement `127.0.0.1`, un relais peut présenter
 * `127.0.0.2`. Les octets sont bornés : un contrôle d'autorisation ne doit
 * rien accepter qui ne soit pas une adresse. `0.0.0.0` et `::` en sont
 * exclus : ce sont des adresses d'ÉCOUTE (toutes les interfaces), pas des
 * destinations.
 *
 * @param hostname - nom d'hôte NU, sans port (`[::1]` accepté).
 * @returns `true` si seule la machine locale est désignée.
 */
const isLoopbackHostname = (hostname: string): boolean => {
  const h = hostname.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  return h === "localhost" || h === "::1" || LOOPBACK_V4_RE.test(h);
};

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
  thenMaybe,
  finallyMaybe,
  isSubclassOf,
  stripTrailingSlashes,
  escapeRegExp,
  isLoopbackHostname,
};
export type { MaybePromise };
