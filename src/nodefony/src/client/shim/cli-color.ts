/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shim browser de `cli-color` — identity functions. Le browser n'a pas de TTY
 * ANSI ; le ConsoleTransport browser utilise `console.log("%c", css)` à la place.
 *
 * Tout accès `.yellow.bold("foo")` retourne `"foo"` sans modification.
 */
const identity = (s: any): any => s;
const proxy: any = new Proxy(identity, {
  get: () => proxy,
});
export default proxy;
