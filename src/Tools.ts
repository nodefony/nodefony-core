/* eslint-disable @typescript-eslint/no-explicit-any */
import Container from "./Container";
import _ from "lodash";
const { isArray, isFunction, isRegExp } = _;
const myobj = {};
const hasOwn = myobj.hasOwnProperty;
const fnToString = hasOwn.toString;
const ObjectFunctionString = fnToString.call(Object);
const getProto = Object.getPrototypeOf;

const isPlainObject = (obj: any): boolean => {
  if (!obj || toString.call(obj) !== "[object Object]") {
    return false;
  }
  const proto: any = getProto(obj);
  if (!proto) {
    return true;
  }
  const Ctor: any = hasOwn.call(proto, "constructor") && proto.constructor;
  return (
    typeof Ctor === "function" && fnToString.call(Ctor) === ObjectFunctionString
  );
};

const isUndefined = (value: any): boolean => {
  return value === undefined;
};

const isEmptyObject = (obj: any): boolean => {
  let name;
  for (name in obj) {
    return false;
  }
  return true;
};

const extend = (...args: any[]) => {
  let options,
    name,
    src,
    copy,
    copyIsArray,
    clone,
    target = args[0] || {},
    i = 1,
    deep = false;
  const { length } = args;

  // Handle a deep copy situation
  if (typeof target === "boolean") {
    deep = target;
    // Skip the boolean and the target
    target = args[i] || {};
    i++;
  }
  // Handle case when target is a string or something (possible in deep copy)
  if (typeof target !== "object" && typeof target !== "function") {
    target = {};
  }
  // Extend Nodefony itself if only one argument is passed
  if (i === length) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    target = {};
    i--;
  }
  for (; i < length; i++) {
    // Only deal with non-null/undefined values
    if ((options = args[i]) != null) {
      // Extend the base object
      for (name in options) {
        copy = options[name];
        // Prevent Object.prototype pollution
        // Prevent never-ending loop
        if (name === "__proto__" || target === copy) {
          continue;
        }
        // Recurse if we're merging plain objects or arrays
        if (
          deep &&
          copy &&
          (isPlainObject(copy) || (copyIsArray = Array.isArray(copy)))
        ) {
          src = target[name];
          // Ensure proper type for the source value
          if (copyIsArray && !Array.isArray(src)) {
            clone = [];
          } else if (!copyIsArray && !isPlainObject(src)) {
            clone = {};
          } else {
            clone = src;
          }
          copyIsArray = false;
          // Never move original objects, clone them
          target[name] = extend(deep, clone, copy);
          // Don't bring in undefined values
        } else if (copy !== undefined) {
          target[name] = copy;
        }
      }
    }
  }
  // Return the modified object
  return target;
};

/**
 *  @method typeOf
 *  @param  value
 *  @return {String} type of value
 */
const typeOf = (value: any): string | null => {
  const t = typeof value;
  if (t === "object") {
    if (value === null) {
      return null;
    }
    if (Buffer.isBuffer(value)) {
      return "buffer";
    }
    if (isArray(value)) {
      return "array";
    }
    if (isFunction(value)) {
      return "function";
    }
    if (value instanceof Date) {
      return "date";
    }
    if (isRegExp(value)) {
      return "RegExp";
    }
    if (value.callee) {
      return "arguments";
    }
    if (value instanceof SyntaxError) {
      return "SyntaxError";
    }
    if (isError(value)) {
      return "Error";
    }
  } else if (t === "function" && typeof value.call === "undefined") {
    return "object";
  }
  return t;
};

const isContainer = (container: Container): boolean => {
  if (container) {
    if (container instanceof Container) {
      return true;
    }
    return false;
  }
  return false;
};

const isError = (it: Error): boolean => {
  return it instanceof Error;
};

const isPromise = (obj: any): boolean => {
  switch (true) {
    case obj instanceof Promise:
      //case obj instanceof BlueBird:
      return true;
    default:
      return (
        Boolean(obj) &&
        (typeof obj === "object" || typeof obj === "function") &&
        typeof obj.then === "function"
      );
  }
};

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
};
