/**
 * Garde « objet simple » — module FEUILLE, sans aucun import.
 *
 * Il vit à part de `Tools.ts` (qui le réexporte) pour être lisible depuis les
 * briques du bas de l'arbre — `Pdu`, la provenance de config — sans les faire
 * entrer dans le cycle `Tools → Container → Syslog → Pdu`.
 */

// Références natives mises en cache (évite les lookups prototypiques répétés).
const ObjProto = Object.prototype;
const FnProto = Function.prototype;
// Appels par `.call` sur les références natives : aucune méthode n'est détachée
// de son objet (explicite — ne dépend plus du global toString).
const _toString = (value: unknown): string => ObjProto.toString.call(value);
const fnToString = (fn: unknown): string => FnProto.toString.call(fn);
const ObjectFunctionString = fnToString(Object);
const getProto = Object.getPrototypeOf;

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
export const isPlainObject = (obj: unknown): obj is Record<string, unknown> => {
  // Primitive ou fonction : écartée AVANT `toString.call`, qui emballerait
  // une primitive en objet pour rien.
  if (typeof obj !== "object" || obj === null) return false;
  if (_toString(obj) !== "[object Object]") return false;
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
