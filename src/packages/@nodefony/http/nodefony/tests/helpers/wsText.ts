/// <reference types="node" />
import type { RawData } from "ws";

/**
 * Texte d'une trame reçue par le client `ws` : `Buffer` (défaut `nodebuffer`),
 * `ArrayBuffer` ou fragments `Buffer[]` — sans passer par un `toString()` qui
 * rendrait `[object ArrayBuffer]`.
 *
 * @param data - la charge reçue dans l'événement `message`.
 * @returns le contenu décodé en UTF-8.
 */
export function rawDataText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}

/**
 * Normalise une valeur levée en `Error` avant de rejeter une promesse de test
 * (une `Error` passe telle quelle, le reste est enveloppé).
 *
 * @param e - la valeur levée ou reçue.
 */
export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
