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

const isArray = Array.isArray;

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

const isRegExp = (value: unknown): value is RegExp => value instanceof RegExp;

// ─── isPlainObject ────────────────────────────────────────────────────────────

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

const isUndefined = (value: unknown): value is undefined => value === undefined;

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

const typeOf = (value: any): string | null => {
  const t = typeof value;
  if (t === "object") {
    if (value === null) return null;
    if (Buffer.isBuffer(value)) return "buffer";
    if (isArray(value)) return "array";
    if (value instanceof Date) return "date";
    if (isRegExp(value)) return "RegExp";
    if (value.callee) return "arguments";
    if (value instanceof SyntaxError) return "SyntaxError";
    if (isError(value)) return "Error";
  } else if (t === "function" && typeof value.call === "undefined") {
    return "object";
  }
  return t;
};

// ─── Utilitaires conteneur / promesse / erreur ────────────────────────────────

const isContainer = (container: unknown): container is Container =>
  container instanceof Container;

const isError = (it: unknown): it is Error => it instanceof Error;

const isPromise = (obj: any): boolean => {
  if (obj instanceof Promise) return true;
  return (
    Boolean(obj) &&
    (typeof obj === "object" || typeof obj === "function") &&
    typeof obj.then === "function"
  );
};

const isSubclassOf = (subclass: any, superclass: any): boolean =>
  subclass.prototype instanceof superclass;

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
};
