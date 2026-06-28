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

/**
 * Shim browser de `util.styleText` — identité (le navigateur n'a pas de TTY
 * ANSI). Consommé par la façade couleur `src/colors.ts` → jamais d'ANSI côté
 * client (parité ancien shim `cli-color` identity Proxy).
 */
export const styleText = (
  _format: any,
  text: string | number,
  _opts?: any,
): string => String(text);
