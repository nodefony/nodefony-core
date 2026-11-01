/**
 * Formatage **pur** (0 état) du CONTENU d'un message WebSocket pour le log de trace
 * (Suivi de requête Studio). Séparé de `WebsocketContext` pour être testable aux
 * limites sans serveur.
 *
 * 🔒 Robustesse binaire (cf doc `ws` — `socket.send(data)` accepte
 * `String | Number | Object | Buffer | ArrayBuffer | TypedArray | DataView |
 * Buffer[] | Blob`, et l'event `message` livre `Buffer | ArrayBuffer | Buffer[]`).
 * **Toute** charge binaire est résumée `[binary N B]` — JAMAIS vidée octet par
 * octet (`JSON.stringify(new Uint8Array(...))` produirait `{"0":..,"1":..}`, énorme
 * et faux). Quand la connexion a négocié un codec de frame (CBOR, ADR-0022 §2), la
 * trame est en plus DÉCODÉE pour être lisible : le débogage se fait à l'observation,
 * jamais en changeant le fil.
 */
import { binaryPayloadLabel, type IFrameCodec } from "nodefony";

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
 * Octets imbriqués dans une valeur JSON : leur étiquette, jamais leur vidage.
 *
 * Lit la valeur BRUTE chez son parent (`this[key]`) : `JSON.stringify` appelle
 * `toJSON` avant le replacer, et un `Buffer` — ce que rend un décodage depuis la
 * trame de `ws` — y deviendrait `{"type":"Buffer","data":[…]}`.
 */
function binaryAsLabel(this: object, key: string, value: unknown): unknown {
  const raw: unknown = Reflect.get(this, key);
  if (ArrayBuffer.isView(raw)) return binaryPayloadLabel(raw.byteLength);
  if (raw instanceof ArrayBuffer) return binaryPayloadLabel(raw.byteLength);
  return value;
}

/** Sérialisation d'une valeur pour une ligne de journal — jamais de levée. */
function stringifyForLog(value: unknown): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(value, binaryAsLabel);
  } catch {
    // Repli VOULU sur `String()` : un BigInt garde sa valeur, un objet
    // cyclique rend `[object Object]` — acceptable pour une ligne de log.
    return String(value); // cycle, BigInt…
  }
  // JSON.stringify(fonction | undefined | symbol) === undefined.
  // Même repli voulu (symbole, fonction) — cf ci-dessus.
  return typeof s === "string" ? s : String(value);
}

/** Tronque à `cap` caractères, ellipse comprise au-delà. */
function bound(s: string, cap: number): string {
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

/**
 * Formate une charge utile WS en chaîne **bornée** et **sûre** pour le log :
 *  - `string` → tronquée à `cap` (+ ellipse) ;
 *  - binaire (cf {@link binaryByteLength}) → `[binary N B]` (jamais de vidage) ;
 *    avec un `codec`, une trame d'un seul tenant est aussi décodée :
 *    `[binary N B] <protocole> <frame en JSON>`, octets imbriqués étiquetés ;
 *    illisible → `[binary N B] <protocole> illisible` ;
 *  - `null`/`undefined` → `""` ;
 *  - objet « JSON » → `JSON.stringify` compact tronqué (cycle, `bigint`, valeur
 *    non sérialisable → repli `String(...)`).
 *
 * @param data - charge utile (RECEIVE/SEND/BROADCAST).
 * @param cap - longueur max avant troncature (défaut {@link WS_LOG_CONTENT_CAP}).
 * @param codec - codec des trames binaires de la connexion, `null` = octets bruts.
 * @returns la ligne à journaliser, jamais plus longue que `cap` + 1.
 */
export function formatWsLogContent(
  data: unknown,
  cap = WS_LOG_CONTENT_CAP,
  codec: IFrameCodec | null = null,
): string {
  if (typeof data === "string") return bound(data, cap);
  if (data === null || data === undefined) return "";
  const bytes = binaryByteLength(data);
  if (bytes >= 0) {
    const label = binaryPayloadLabel(bytes);
    // Seule une trame d'un seul tenant se décode (un `Buffer` EST un
    // `Uint8Array`) : des fragments ou un `Blob` restent résumés.
    if (codec === null || !(data instanceof Uint8Array)) return label;
    let frame: unknown;
    try {
      frame = codec.decode(data);
    } catch {
      return `${label} ${codec.protocol} illisible`;
    }
    return bound(`${label} ${codec.protocol} ${stringifyForLog(frame)}`, cap);
  }
  return bound(stringifyForLog(data), cap);
}
