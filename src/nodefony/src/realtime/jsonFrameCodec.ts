/**
 * Codec JSON de la socket temps réel (`nodefony.jsonrpc.v1`) — le défaut de toute
 * connexion qui n'a négocié aucun autre codec (ADR-0022 §2).
 *
 * Deux variantes, un seul sous-protocole : {@link JSON_FRAME_CODEC} (les deux appels
 * natifs, le défaut) et {@link JSON_BYTES_FRAME_CODEC} (la convention déclarée des octets,
 * `{"$bytes":"<base64url sans bourrage>"}`, armée quand l'application active un codec
 * binaire — ADR-0022 §2, ADR-0021 S8).
 */
import { fromBase64Url, toBase64Url } from "./base64url";
import { JSON_PROTOCOL, type IFrameCodec } from "./IFrameCodec";

/** Clé réservée du marqueur d'octets dans le codec JSON. */
export const BYTES_MARKER = "$bytes";

/** Profondeur au-delà de laquelle le parcours renonce — `JSON.stringify` lèvera de lui-même sur un cycle. */
const MAX_WALK_DEPTH = 64;

/**
 * Dit si une valeur contient un `Uint8Array`, à n'importe quelle profondeur.
 *
 * Ne descend que dans les objets et tableaux ; s'arrête au premier trouvé. Une
 * structure circulaire s'arrête à la borne de profondeur.
 *
 * @param value - la frame ou la charge à inspecter.
 * @returns `true` dès qu'un `Uint8Array` est rencontré.
 */
export function containsBytes(value: unknown): boolean {
  return walk(value, 0);
}

/** Objet indexable par clé — garde de type, sans conversion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function walk(value: unknown, depth: number): boolean {
  if (value instanceof Uint8Array) return true;
  if (depth >= MAX_WALK_DEPTH) return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i];
      if (item !== null && typeof item === "object" && walk(item, depth + 1))
        return true;
    }
    return false;
  }
  if (!isRecord(value)) return false;
  for (const key in value) {
    const item = value[key];
    if (item !== null && typeof item === "object" && walk(item, depth + 1))
      return true;
  }
  return false;
}

/**
 * Remplace des octets par le marqueur. `JSON.stringify` a DÉJÀ appelé `toJSON` quand il
 * passe la valeur ici — or un `Buffer` de Node en a un (`{type:"Buffer",data:[…]}`).
 * L'original se relit donc sur le conteneur (`this[key]`, ECMA-262
 * `SerializeJSONProperty`) : les octets passent avant `toJSON`, comme dans le codec CBOR.
 */
function bytesReplacer(this: unknown, key: string, value: unknown): unknown {
  const original = isRecord(this) ? this[key] : value;
  if (original instanceof Uint8Array)
    return { [BYTES_MARKER]: toBase64Url(original) };
  if (isLoneMarker(value)) throw forgedMarkerError(key);
  return value;
}

/**
 * Dit si une valeur a exactement la forme que le récepteur réanime en octets :
 * un objet dont la SEULE clé est le marqueur, porteur d'une chaîne. Même règle
 * que {@link bytesReviver}, lue de l'autre côté du fil.
 */
function isLoneMarker(value: unknown): boolean {
  if (!isRecord(value) || Array.isArray(value)) return false;
  if (typeof value[BYTES_MARKER] !== "string") return false;
  for (const key in value) if (key !== BYTES_MARKER) return false;
  return true;
}

/**
 * Un objet applicatif qui a la forme exacte du marqueur ne peut pas traverser ce
 * codec : le récepteur le relirait en octets (ou jetterait la trame entière si sa
 * chaîne n'est pas du base64url), alors qu'un abonné CBOR recevrait l'objet. On
 * le REFUSE plutôt que de laisser la même publication changer de nature selon le
 * codec du récepteur. La valeur n'est jamais recopiée dans le message.
 */
/** Longueur de clé recopiée dans le message d'un marqueur forgé. */
const MAX_KEY_SHOWN = 64;

function forgedMarkerError(key: string): TypeError {
  // La clé est choisie par l'émetteur et finit au journal : bornée, puis échappée
  // par `JSON.stringify` (sauts de ligne, séquences ANSI) — ni ligne de journal
  // forgée, ni inondation (CWE-117).
  const shown = JSON.stringify(
    key.length > MAX_KEY_SHOWN ? `${key.slice(0, MAX_KEY_SHOWN)}…` : key,
  );
  return new TypeError(
    `codec JSON : objet {"${BYTES_MARKER}": …} non issu d'octets` +
      (key === "" ? "" : ` sous la clé ${shown}`) +
      " — le récepteur le relirait en octets ; envoyer un Uint8Array, ou ajouter une autre clé à l'objet",
  );
}

function bytesReviver(_key: string, value: unknown): unknown {
  if (!isRecord(value) || Array.isArray(value)) return value;
  const marker = value[BYTES_MARKER];
  if (typeof marker !== "string") return value;
  // Le marqueur doit être SEUL : `{ $bytes, autre }` reste un objet applicatif.
  for (const key in value) if (key !== BYTES_MARKER) return value;
  return fromBase64Url(marker);
}

function binaryFrameError(): TypeError {
  return new TypeError(
    "codec JSON : trame binaire reçue — ce codec ne lit que du texte",
  );
}

/**
 * Motif cherché dans le texte avant de payer le reviver (réception) ou le replacer
 * (émission). SANS guillemets, volontairement : un motif qui commence par `"` bute
 * sur chaque guillemet du JSON, et V8 bascule alors sur une recherche à table qu'il
 * reconstruit à chaque appel — mesuré ~220 ns sur une trame de 80 octets, contre
 * quelques dizaines avec `$bytes`, caractère rare dans du JSON. Un filtre large ne
 * coûte que des faux positifs, que le reviver et le replacer tranchent.
 */
const MARKER_PROBE = BYTES_MARKER;

/**
 * Le codec JSON par défaut de la socket : `JSON.stringify` / `JSON.parse`, rien d'autre.
 *
 * Aucun parcours de la charge : un `Uint8Array` imbriqué y sort déformé (`{"0":1,…}`),
 * comme `JSON.stringify` le rend. Les octets se portent en activant un codec binaire,
 * qui arme {@link JSON_BYTES_FRAME_CODEC} pour les connexions texte (ADR-0022 §2).
 */
export const JSON_FRAME_CODEC = {
  protocol: JSON_PROTOCOL,
  encode(frame: unknown): string {
    return JSON.stringify(frame);
  },
  decode(data: string | Uint8Array): unknown {
    if (typeof data !== "string") throw binaryFrameError();
    return JSON.parse(data);
  },
} satisfies IFrameCodec;

/**
 * Le codec JSON quand l'application a ACTIVÉ le binaire : la convention `$bytes` pour
 * les octets, à toute profondeur, dans les deux sens.
 *
 * L'émission paie un parcours de la charge ({@link containsBytes}) — mesuré +27 à +35 %
 * par trame, d'où son armement à l'activation seulement. La réception ne paie qu'un
 * `includes` sur le texte, puis le reviver si le marqueur y figure.
 *
 * Un objet applicatif qui a la forme EXACTE du marqueur (seule clé, valeur chaîne) est
 * refusé à l'émission : relu en octets d'un côté, en objet de l'autre, il changerait de
 * nature selon le codec du récepteur (ADR-0022 §2).
 *
 * Un client ne l'arme pas de lui-même : il le prend quand l'accueil du serveur annonce
 * la convention (champ `bytes`, `adoptFrameCodec`). Sur le fil d'un serveur sans codec,
 * un objet applicatif `{"$bytes": …}` changerait sinon de nature.
 */
export const JSON_BYTES_FRAME_CODEC = {
  protocol: JSON_PROTOCOL,
  // Annoncé par le serveur dans l'accueil : un client resté en texte s'y accorde.
  bytesMarker: BYTES_MARKER,
  encode(frame: unknown): string {
    if (containsBytes(frame)) return JSON.stringify(frame, bytesReplacer);
    const text = JSON.stringify(frame);
    // Sans octets, le marqueur n'a rien à faire dans le texte produit : présent,
    // c'est un objet applicatif qui en a la forme, ou une simple chaîne qui le
    // contient. Le replacer tranche, et lève sur le premier cas. Coût sur le
    // chemin normal : un `includes`, le même que paie le décodage.
    if (text.includes(MARKER_PROBE))
      return JSON.stringify(frame, bytesReplacer);
    return text;
  },
  decode(data: string | Uint8Array): unknown {
    if (typeof data !== "string") throw binaryFrameError();
    return data.includes(MARKER_PROBE)
      ? JSON.parse(data, bytesReviver)
      : JSON.parse(data);
  },
} satisfies IFrameCodec;
