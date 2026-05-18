/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shim browser de `node:util` — fournit `inspect` via JSON.stringify.
 * Suffisant pour la sortie Syslog côté browser (debug/log uniquement).
 */
export const inspect = (
  obj: any,
  _opts?: { colors?: boolean; depth?: number },
): string => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};
