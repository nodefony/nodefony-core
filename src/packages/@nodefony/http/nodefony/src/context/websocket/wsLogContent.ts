/**
 * Formatage **pur** (0 état, 0 dépendance) du CONTENU d'un message WebSocket pour
 * le log de trace (Suivi de requête Studio). Séparé de `WebsocketContext` pour
 * être testable aux limites sans serveur.
 *
 * 🔒 Robustesse binaire (cf doc `ws` — `socket.send(data)` accepte
 * `String | Number | Object | Buffer | ArrayBuffer | TypedArray | DataView |
 * Buffer[] | Blob`, et l'event `message` livre `Buffer | ArrayBuffer | Buffer[]`).
 * **Toute** charge binaire est résumée `[binary N B]` — JAMAIS sérialisée
 * (`JSON.stringify(new Uint8Array(...))` produirait `{"0":..,"1":..}`, énorme et
 * faux). Seules string et objets « JSON » sont rendus en texte (borné).
 */

/** Cap de troncature du contenu loggé (octets/chars). Borne ring + JSONL. */
export const WS_LOG_CONTENT_CAP = 4096;

/**
 * Taille en octets d'une charge **binaire** reconnue, ou `-1` si la valeur n'est
 * pas binaire (→ à traiter en JSON/texte). Couvre tous les types binaires que
 * `ws` accepte/livre : `Buffer`, `ArrayBuffer`, vues (`TypedArray`/`DataView`),
 * `Blob` (Node ≥ 18), et `Buffer[]` (fragments — binaire ssi TOUS ses éléments
 * le sont, sinon c'est un tableau JSON ordinaire).
 *
 * @param data - valeur à mesurer.
 * @returns nombre d'octets, ou `-1` si non binaire.
 */
export function binaryByteLength(data: unknown): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength; // TypedArray | DataView
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  if (Array.isArray(data)) {
    let total = 0;
    for (const part of data) {
      const n = binaryByteLength(part);
      if (n < 0) return -1; // un élément non binaire → tableau JSON, pas des fragments
      total += n;
    }
    return total; // Buffer[] (fragments ws) — y compris [] → 0 octet
  }
  return -1;
}

/**
 * Formate une charge utile WS en chaîne **bornée** et **sûre** pour le log :
 *  - `string` → tronquée à `cap` (+ ellipse) ;
 *  - binaire (cf {@link binaryByteLength}) → `[binary N B]` (jamais de dump) ;
 *  - `null`/`undefined` → `""` ;
 *  - objet « JSON » → `JSON.stringify` compact tronqué (cycle, `bigint`, valeur
 *    non sérialisable → repli `String(...)`).
 *
 * @param data - charge utile (RECEIVE/SEND/BROADCAST).
 * @param cap - longueur max avant troncature (défaut {@link WS_LOG_CONTENT_CAP}).
 */
export function formatWsLogContent(
  data: unknown,
  cap = WS_LOG_CONTENT_CAP,
): string {
  if (typeof data === "string")
    return data.length > cap ? `${data.slice(0, cap)}…` : data;
  if (data === null || data === undefined) return "";
  const bytes = binaryByteLength(data);
  if (bytes >= 0) return `[binary ${bytes} B]`;
  let s: string;
  try {
    s = JSON.stringify(data);
  } catch {
    return String(data); // cycle, BigInt…
  }
  // JSON.stringify(fonction | undefined | symbol) === undefined.
  if (typeof s !== "string") return String(data);
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}
