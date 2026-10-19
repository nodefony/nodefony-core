/**
 * Lecture du stockage navigateur (`localStorage` / `sessionStorage`) — le lecteur
 * UNIQUE des préférences persistées de Studio.
 *
 * Ce qu'on relit là n'est pas ce qu'on a écrit : une version antérieure de
 * Studio a pu y poser une autre forme, l'utilisateur a pu l'éditer à la main, une
 * extension a pu y toucher. Une préférence relue telle quelle et convertie
 * (`JSON.parse(raw) as T`) passe le typage puis casse au rendu — écran blanc à
 * chaque montage, sans autre issue que de vider le stockage. D'où la règle :
 * la valeur sort d'ici en `unknown`, et chaque lecteur la reconstruit champ par
 * champ avec les gardes de `utils/guards.ts`, en abandonnant ce qu'il ne
 * reconnaît pas.
 */

/** Les deux stockages du navigateur. */
export type BrowserStorageKind = "local" | "session";

/**
 * Le stockage navigateur demandé, ou `null` s'il n'est pas joignable.
 *
 * Hors navigateur il n'existe pas ; en navigation privée ou dans une iframe
 * isolée, le simple ACCÈS à `window.localStorage` peut lever.
 *
 * @param kind - `local` (survit à l'onglet) ou `session` (vit avec l'onglet)
 * @returns le stockage, ou `null`
 */
export function browserStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Relit une valeur JSON du stockage navigateur sans en présumer la forme.
 *
 * @param kind - stockage à lire
 * @param key - clé de la préférence
 * @returns la valeur décodée, à garder avant usage ; `undefined` si la clé est
 *   absente, le stockage injoignable ou le contenu n'est pas du JSON
 */
export function readStoredJson(kind: BrowserStorageKind, key: string): unknown {
  const storage = browserStorage(kind);
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
