/** Ce que l'on lit de `crypto` : `randomUUID` peut manquer, `getRandomValues` jamais. */
interface IUuidCrypto {
  randomUUID?: () => string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * Génère un UUID v4, y compris dans une page servie hors contexte sécurisé.
 *
 * `crypto.randomUUID()` n'existe que dans un contexte sécurisé (HTTPS, ou la
 * boucle locale) : une page ouverte en `http://<IP de LAN>` — un téléphone, une
 * TV, une tablette sur le réseau du poste — n'en dispose pas, et l'appel lève.
 * `crypto.getRandomValues()` est, lui, disponible partout : on y retombe en
 * posant les bits de version et de variante de la RFC 9562 §5.4.
 *
 * @returns un UUID v4 au format canonique (36 caractères, minuscules).
 */
export function randomUuid(): string {
  const crypto = globalThis.crypto as unknown as IUuidCrypto;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
