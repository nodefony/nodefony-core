import {
  createHmac,
  createSecretKey,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { ownField, type IFrameCodec } from "nodefony";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

/**
 * **Sceau d'enveloppe backplane** — authenticité des messages transportés sur un
 * bus **PARTAGÉ** (Redis pub/sub, et tout driver userland cross-host : NATS,
 * RabbitMQ…). Mutualisé ici pour qu'un driver tiers hérite de la même garantie
 * sans la réécrire (F83).
 *
 * Pourquoi : un bus partagé n'authentifie pas l'ÉMETTEUR d'un message. Sans sceau,
 * quiconque écrit dans le Redis (autre app d'un Redis mutualisé, credential fuité,
 * SSRF vers le port Redis) publie sur les canaux de **tous** les pods de l'app.
 * Le sceau prouve que le message vient d'un pair qui détient le secret partagé.
 *
 * Ce qui NE s'applique PAS ici : le {@link ClusterBackplane} (IPC). Son transport
 * est authentifié par construction — un canal IPC ne relie qu'un master à SES
 * propres workers, il n'existe aucun tiers capable d'y écrire. Y imposer un secret
 * serait de la friction pure.
 *
 * Algorithme : HMAC-SHA256 sur la **chaîne canonique** `originId\nchannel\npayload`
 * (payload sérialisé), encodé en base64url. Comparaison à temps constant
 * ({@link timingSafeEqual}) — une comparaison `===` fuiterait le sceau attendu
 * octet par octet.
 *
 * Portée : le sceau couvre l'origine, le canal ET la charge → ni repointage de
 * canal (`chat:` → `nodefony:audit`), ni substitution de charge.
 *
 * Hors portée (assumé, cf sémantique at-most-once du port) : le **rejeu**. Un
 * tiers qui lit le bus peut re-publier un message scellé intact. Pour une
 * publication, l'effet se limite à re-diffuser une charge déjà diffusée sur un
 * canal déjà broadcast. Pour un **ordre** (fermer, éjecter), le rejeu RECOUPE —
 * l'effet reste soustractif, jamais une admission (ADR-0022 §6 d4). Une fin vise
 * un canal qui porte son instance (`room:42:<partie>`) : rejouée, elle ne désigne
 * plus rien de vivant. Une éjection vise `(canal, compte)` : rejouée sur un canal
 * DURABLE, elle recoupe le compte à chaque réadmission — risque accepté en 10.0,
 * borné (écrire sur le bus est requis ; changer le secret rend caducs les ordres
 * captés), parade réservée par le champ optionnel `generation` de l'ordre. Un
 * anti-rejeu par horodatage exigerait des horloges alignées entre pods.
 *
 * **Aucune reconversion de la charge** (ADR-0021 S6) : à l'envoi, la charge est
 * encodée UNE fois et l'enveloppe assemblée par fragments ; à la réception, le
 * sceau se vérifie sur la TRANCHE reçue de la charge, et l'écho d'un pod se
 * reconnaît à la fin du message, sans le décoder. Une forme différente (producteur
 * tiers : clés dans un autre ordre, espaces, nombres non canoniques) retombe sur la
 * vérification par re-sérialisation : on accepte strictement plus qu'avant, jamais
 * moins.
 *
 * Pourquoi lire la tranche reçue est sûr : le sceau valide un triplet (origine,
 * canal, texte de la charge) émis par un pair ; la forme vérifiée autour de la
 * tranche est exactement celle qu'il écrit, donc le message reçu EST ce message
 * émis, octet pour octet — et son décodage, déterministe, rend la charge signée.
 */

/** Nom du champ portant le sceau dans l'enveloppe sérialisée. */
const SEAL_FIELD = "sig";

/** Longueur d'un sceau : HMAC-SHA256 (32 octets) en base64url, sans remplissage. */
const SEAL_CHARS = 43;

/** Enveloppe transportée : le message + son sceau optionnel. */
interface SealedEnvelope extends IBackplaneMessage {
  /** HMAC base64url de la chaîne canonique ; absent si aucun secret n'est posé. */
  [SEAL_FIELD]?: string;
}

// ---------------------------------------------------------------------------
// Fragments fixes de l'enveloppe TEXTE, dans l'ordre où l'émetteur les écrit :
// {"channel":C,"payload":P,"originId":O,"sig":"S"}
// ---------------------------------------------------------------------------

const TEXT_HEAD = '{"channel":';
const TEXT_PAYLOAD_KEY = ',"payload":';
const TEXT_ORIGIN_KEY = ',"originId":';
const TEXT_SEAL_KEY = `,"${SEAL_FIELD}":"`;
const TEXT_SEAL_END = '"}';
/**
 * Guillemet fermant du canal suivi de la clé de charge. Cette suite ne peut
 * apparaître DANS une chaîne JSON — un `"` y est toujours échappé — donc sa
 * première occurrence après l'ouverture du canal en marque la fin.
 */
const TEXT_CHANNEL_CLOSE = `"${TEXT_PAYLOAD_KEY}`;
const TEXT_HEAD_LEN = TEXT_HEAD.length;
const TEXT_PAYLOAD_KEY_LEN = TEXT_PAYLOAD_KEY.length;
const TEXT_ORIGIN_KEY_LEN = TEXT_ORIGIN_KEY.length;
const TEXT_SEAL_KEY_LEN = TEXT_SEAL_KEY.length;
const TEXT_SEAL_END_LEN = TEXT_SEAL_END.length;
const TEXT_CHANNEL_CLOSE_LEN = TEXT_CHANNEL_CLOSE.length;
/** `"` — ouvre la chaîne JSON du canal. */
const QUOTE = 0x22;

// ---------------------------------------------------------------------------
// Fragments fixes de l'enveloppe BINAIRE (CBOR, RFC 8949), même ordre :
// map(4) "channel" C "payload" P "originId" O "sig" S — map(3) sans sceau.
// ---------------------------------------------------------------------------

/** En-tête d'une map CBOR de 3 entrées (enveloppe nue). */
const CBOR_MAP_3 = 0xa3;
/** En-tête d'une map CBOR de 4 entrées (enveloppe scellée). */
const CBOR_MAP_4 = 0xa4;
/** Type majeur 3 (chaîne de texte), longueur dans l'octet initial (< 24). */
const CBOR_TEXT = 0x60;
/** Chaîne de texte, longueur sur 1 / 2 / 4 octets qui suivent. */
const CBOR_TEXT_1 = 0x78;
const CBOR_TEXT_2 = 0x79;
const CBOR_TEXT_4 = 0x7a;

/** Taille de l'en-tête CBOR d'une chaîne de texte de `len` octets (forme la plus courte). */
function cborTextHeadSize(len: number): number {
  if (len < 24) return 1;
  if (len < 0x100) return 2;
  if (len < 0x10000) return 3;
  return 5;
}

/** Écrit l'en-tête CBOR d'une chaîne de `len` octets ; rend la position suivante. */
function writeCborTextHead(out: Uint8Array, at: number, len: number): number {
  if (len < 24) {
    out[at] = CBOR_TEXT + len;
    return at + 1;
  }
  if (len < 0x100) {
    out[at] = CBOR_TEXT_1;
    out[at + 1] = len;
    return at + 2;
  }
  if (len < 0x10000) {
    out[at] = CBOR_TEXT_2;
    out[at + 1] = len >>> 8;
    out[at + 2] = len & 0xff;
    return at + 3;
  }
  out[at] = CBOR_TEXT_4;
  out[at + 1] = len >>> 24;
  out[at + 2] = (len >>> 16) & 0xff;
  out[at + 3] = (len >>> 8) & 0xff;
  out[at + 4] = len & 0xff;
  return at + 5;
}

/** L'en-tête CBOR d'une chaîne de `len` octets se trouve-t-il à `at` (forme la plus courte) ? */
function cborTextHeadAt(raw: Uint8Array, at: number, len: number): boolean {
  if (len < 24) return raw[at] === CBOR_TEXT + len;
  if (len < 0x100) return raw[at] === CBOR_TEXT_1 && raw[at + 1] === len;
  if (len < 0x10000)
    return (
      raw[at] === CBOR_TEXT_2 &&
      raw[at + 1] === len >>> 8 &&
      raw[at + 2] === (len & 0xff)
    );
  return (
    raw[at] === CBOR_TEXT_4 &&
    raw[at + 1] === len >>> 24 &&
    raw[at + 2] === ((len >>> 16) & 0xff) &&
    raw[at + 3] === ((len >>> 8) & 0xff) &&
    raw[at + 4] === (len & 0xff)
  );
}

/**
 * Longueur de la chaîne CBOR dont l'en-tête est à `at`, et taille de cet en-tête,
 * écrites dans `into` (`[longueur, taille]`) ; `false` si ce n'est pas une chaîne
 * de texte à longueur définie.
 */
function readCborTextHead(
  raw: Uint8Array,
  at: number,
  into: [number, number],
): boolean {
  const b = raw[at];
  if (b === undefined) return false;
  if (b >= CBOR_TEXT && b < CBOR_TEXT_1) {
    into[0] = b - CBOR_TEXT;
    into[1] = 1;
    return true;
  }
  if (b === CBOR_TEXT_1 && at + 1 < raw.length) {
    into[0] = raw[at + 1] ?? 0;
    into[1] = 2;
    return true;
  }
  if (b === CBOR_TEXT_2 && at + 2 < raw.length) {
    into[0] = ((raw[at + 1] ?? 0) << 8) | (raw[at + 2] ?? 0);
    into[1] = 3;
    return true;
  }
  if (b === CBOR_TEXT_4 && at + 4 < raw.length) {
    into[0] =
      (((raw[at + 1] ?? 0) << 24) >>> 0) +
      (((raw[at + 2] ?? 0) << 16) |
        ((raw[at + 3] ?? 0) << 8) |
        (raw[at + 4] ?? 0));
    into[1] = 5;
    return true;
  }
  return false;
}

/** Chaîne CBOR complète (en-tête + octets UTF-8) — pour les fragments fixes. */
function cborText(value: string): Uint8Array {
  const len = Buffer.byteLength(value, "utf8");
  const out = new Uint8Array(cborTextHeadSize(len) + len);
  Buffer.from(out.buffer, out.byteOffset, out.byteLength).write(
    value,
    writeCborTextHead(out, 0, len),
    "utf8",
  );
  return out;
}

const CBOR_KEY_CHANNEL = cborText("channel");
const CBOR_KEY_PAYLOAD = cborText("payload");
const CBOR_KEY_ORIGIN = cborText("originId");
const CBOR_KEY_SEAL = cborText(SEAL_FIELD);
/** En-tête de la chaîne du sceau : 43 caractères ASCII. */
const CBOR_SEAL_HEAD = Uint8Array.of(CBOR_TEXT_1, SEAL_CHARS);
/** Octets fixes de la queue scellée, après la chaîne de l'origine. */
const CBOR_SEAL_TAIL_LEN =
  CBOR_KEY_SEAL.length + CBOR_SEAL_HEAD.length + SEAL_CHARS;

/** `frag` est-il présent tel quel dans `raw` à la position `at` ? Aucune allocation. */
function bytesAt(raw: Uint8Array, at: number, frag: Uint8Array): boolean {
  if (at < 0 || at + frag.length > raw.length) return false;
  for (let i = 0; i < frag.length; i += 1)
    if (raw[at + i] !== frag[i]) return false;
  return true;
}

/** Vue `Buffer` sur les mêmes octets (aucune copie) — pour les lectures de chaînes. */
function asBuffer(raw: Uint8Array): Buffer {
  return Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

// ---------------------------------------------------------------------------
// Sceau
// ---------------------------------------------------------------------------

/**
 * Début de la chaîne canonique : `originId\nchannel\n`, fragments JSON. Les deux
 * premiers sont des chaînes échappées : aucun décalage de frontière n'est
 * possible, et la charge, en dernier, n'a pas de frontière à garder.
 */
function sealHead(originIdJson: string, channelJson: string): string {
  return `${originIdJson}\n${channelJson}\n`;
}

/** Dernière clé préparée et son secret (un serveur n'en a qu'un : la case unique suffit). */
let preparedSecret: string | null = null;
let preparedKey: KeyObject | null = null;

/**
 * Clé HMAC préparée UNE fois par secret : une chaîne passée à `createHmac` est
 * réencodée à chaque appel (mesuré : ~150 ns par sceau). Mêmes octets de clé — le
 * secret en UTF-8, comme `createHmac` l'aurait fait.
 */
function keyOf(secret: string): KeyObject {
  if (secret !== preparedSecret || preparedKey === null) {
    preparedKey = createSecretKey(Buffer.from(secret, "utf8"));
    preparedSecret = secret;
  }
  return preparedKey;
}

/**
 * Sceau (HMAC-SHA256 en base64url) de la chaîne canonique — un seul calcul.
 *
 * Une charge TEXTE est concaténée à l'en-tête : un seul passage vers le moteur de
 * hachage coûte moins qu'une concaténation (mesuré : ~250 ns de moins) ; des
 * OCTETS s'ajoutent tels quels, sans copie. Rendu en base64url, jamais en
 * `Buffer` brut : allouer le `Buffer` du résultat coûte plus que de l'encoder
 * (mesuré : ~900 ns).
 */
function sealText(
  head: string,
  payload: string | Uint8Array,
  secret: string,
): string {
  const hmac = createHmac("sha256", keyOf(secret));
  return (
    typeof payload === "string"
      ? hmac.update(head + payload)
      : hmac.update(head).update(payload)
  ).digest("base64url");
}

/**
 * Le sceau fourni correspond-il au sceau calculé ? À temps constant.
 *
 * Voie courante : les deux chaînes base64url comparées caractère par caractère,
 * SANS sortie anticipée (le OU accumulé ne dépend que de la longueur, publique :
 * celle de SHA-256) et sans allocation. Repli : un sceau écrit sous une autre forme
 * base64 (remplissage, alphabet standard) est décodé et comparé par
 * `timingSafeEqual` — on accepte ce qu'on acceptait avant. Le repli ne se prend
 * que si la voie courante échoue : il ne révèle rien du secret.
 */
function sealMatches(provided: string, expected: string): boolean {
  if (provided.length === expected.length) {
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1)
      diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return true;
  }
  const a = Buffer.from(provided, "base64url");
  const b = Buffer.from(expected, "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Voie TEXTE
// ---------------------------------------------------------------------------

/**
 * Sérialise un message backplane, scellé si un secret est fourni.
 *
 * L'enveloppe scellée est assemblée par concaténation des fragments déjà
 * sérialisés — un `JSON.stringify` d'objet complet re-sérialiserait la charge
 * une seconde fois.
 *
 * @param msg - message à transporter (canal, charge, origine).
 * @param secret - secret partagé entre pods ; `null`/`undefined` → enveloppe nue.
 * @returns la chaîne à publier sur le bus.
 */
export function sealBackplaneEnvelope(
  msg: IBackplaneMessage,
  secret?: string | null,
): string {
  if (!secret) return JSON.stringify(msg);
  const channelJson = JSON.stringify(msg.channel);
  const originIdJson = JSON.stringify(msg.originId);
  // `undefined` n'est pas du JSON : une charge absente est SIGNÉE comme `null`.
  // `JSON.stringify` rend `undefined` pour une charge `undefined` — le type
  // standard ne le dit pas. L'enveloppe NUE (sans secret) omet la clé ; le
  // récepteur rend `undefined` dans les deux cas (`openBackplaneEnvelope`).
  const payloadText = JSON.stringify(msg.payload) as string | undefined;
  const payloadJson = payloadText ?? "null";
  const sig = sealText(
    sealHead(originIdJson, channelJson),
    payloadJson,
    secret,
  );
  return (
    TEXT_HEAD +
    channelJson +
    TEXT_PAYLOAD_KEY +
    payloadJson +
    TEXT_ORIGIN_KEY +
    originIdJson +
    TEXT_SEAL_KEY +
    sig +
    TEXT_SEAL_END
  );
}

/** Type-guard d'enveloppe — narrowing sûr d'un message brut venu du bus. */
function isEnvelope(m: unknown): m is SealedEnvelope {
  return (
    typeof ownField(m, "channel") === "string" &&
    typeof ownField(m, "originId") === "string"
  );
}

/**
 * Tranche de la charge dans une enveloppe texte reçue, si elle a EXACTEMENT la
 * forme qu'écrit {@link sealBackplaneEnvelope} pour ce canal, cette origine et ce
 * sceau ; `null` sinon (forme tierce → repli).
 */
function receivedPayloadText(
  raw: string,
  channelJson: string,
  originIdJson: string,
  provided: string,
): string | null {
  const start = TEXT_HEAD_LEN + channelJson.length + TEXT_PAYLOAD_KEY_LEN;
  const originAt =
    raw.length -
    TEXT_SEAL_END_LEN -
    provided.length -
    TEXT_SEAL_KEY_LEN -
    originIdJson.length -
    TEXT_ORIGIN_KEY_LEN;
  if (originAt <= start) return null;
  const sealAt =
    originAt + TEXT_ORIGIN_KEY_LEN + originIdJson.length + TEXT_SEAL_KEY_LEN;
  return raw.startsWith(TEXT_HEAD) &&
    raw.startsWith(channelJson, TEXT_HEAD_LEN) &&
    raw.startsWith(TEXT_PAYLOAD_KEY, start - TEXT_PAYLOAD_KEY_LEN) &&
    raw.startsWith(TEXT_ORIGIN_KEY, originAt) &&
    raw.startsWith(originIdJson, originAt + TEXT_ORIGIN_KEY_LEN) &&
    raw.startsWith(TEXT_SEAL_KEY, sealAt - TEXT_SEAL_KEY_LEN) &&
    raw.startsWith(provided, sealAt) &&
    raw.startsWith(TEXT_SEAL_END, sealAt + provided.length)
    ? raw.slice(start, originAt)
    : null;
}

/**
 * Parse et **vérifie** une enveloppe reçue du bus partagé.
 *
 * Fail-closed strict quand un secret est posé : une enveloppe sans sceau ou au
 * sceau invalide est rejetée — **aucun downgrade** possible en retirant le champ
 * `sig`. Sans secret, l'enveloppe nue est acceptée (compat ; l'alerte de boot qui
 * signale ce mode non authentifié est portée par le wiring du driver).
 *
 * Le sceau se vérifie sur la tranche REÇUE de la charge quand l'enveloppe a la
 * forme qu'écrit {@link sealBackplaneEnvelope} — aucune re-sérialisation ; une
 * autre forme retombe sur la re-sérialisation de la charge lue.
 *
 * @param raw - message brut lu sur le bus.
 * @param secret - secret partagé attendu, ou `null`/`undefined` si aucun.
 * @returns le message vérifié, ou `null` s'il doit être ignoré (malformé, non
 *   scellé alors qu'un secret est exigé, sceau invalide).
 */
export function openBackplaneEnvelope(
  raw: string,
  secret?: string | null,
): IBackplaneMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // JSON malformé sur un canal partagé
  }
  if (!isEnvelope(parsed)) return null;
  const msg: IBackplaneMessage = {
    channel: parsed.channel,
    // `null` n'est plus une charge admise (ADR-0021 S1) : c'est le texte signé d'une
    // charge ABSENTE, rendue `undefined` comme sur les autres bus.
    payload: parsed.payload === null ? undefined : parsed.payload,
    originId: parsed.originId,
  };
  if (!secret) return msg;
  const provided = parsed[SEAL_FIELD];
  if (typeof provided !== "string") return null; // secret exigé → sceau obligatoire
  const channelJson = JSON.stringify(msg.channel);
  const originIdJson = JSON.stringify(msg.originId);
  const head = sealHead(originIdJson, channelJson);
  const slice = receivedPayloadText(raw, channelJson, originIdJson, provided);
  if (slice !== null && sealMatches(provided, sealText(head, slice, secret)))
    return msg;
  // Repli — forme tierce : la charge lue est re-sérialisée. `JSON.stringify` est
  // stable sur la sortie de `JSON.parse` (ordre des clés, forme numérique
  // canonique). Rend `undefined` pour une charge `undefined` — le type ne le dit pas.
  const payloadText = JSON.stringify(msg.payload) as string | undefined;
  return sealMatches(provided, sealText(head, payloadText ?? "null", secret))
    ? msg
    : null;
}

// ---------------------------------------------------------------------------
// Voie BINAIRE
// ---------------------------------------------------------------------------

/** Encode par le codec, et refuse un codec texte : le sujet binaire porte des octets. */
function encodeBytes(codec: IFrameCodec, value: unknown): Uint8Array {
  const out = codec.encode(value);
  if (typeof out === "string")
    throw new TypeError(
      `backplane : le codec « ${codec.protocol} » rend du texte — le sujet binaire du bus exige un codec binaire`,
    );
  return out;
}

/**
 * Assemble l'enveloppe binaire scellée par fragments : la charge, déjà encodée,
 * est recopiée telle quelle — jamais ré-encodée. Une seule zone mémoire.
 *
 * Zone PROPRE (`new Uint8Array`), jamais le pool partagé de `Buffer.allocUnsafe` :
 * une charge décodée de ces octets rend des vues, qui retiendraient tout le bloc du
 * pool. Un `Uint8Array`, comme le codec : un `Buffer` y ferait décoder des
 * `Buffer`. Les chaînes ASCII (le cas courant : canal, origine, sceau) s'écrivent
 * par une boucle, sans objet intermédiaire.
 */
function frameSealedBytes(
  channel: string,
  originId: string,
  payloadBytes: Uint8Array,
  sig: string,
): Uint8Array<ArrayBuffer> {
  const channelLen = Buffer.byteLength(channel, "utf8");
  const originLen = Buffer.byteLength(originId, "utf8");
  const out = new Uint8Array(
    1 +
      CBOR_KEY_CHANNEL.length +
      cborTextHeadSize(channelLen) +
      channelLen +
      CBOR_KEY_PAYLOAD.length +
      payloadBytes.byteLength +
      CBOR_KEY_ORIGIN.length +
      cborTextHeadSize(originLen) +
      originLen +
      CBOR_SEAL_TAIL_LEN,
  );
  out[0] = CBOR_MAP_4;
  let at = 1;
  out.set(CBOR_KEY_CHANNEL, at);
  at = writeCborTextHead(out, at + CBOR_KEY_CHANNEL.length, channelLen);
  at = writeUtf8(out, at, channel, channelLen);
  out.set(CBOR_KEY_PAYLOAD, at);
  at += CBOR_KEY_PAYLOAD.length;
  out.set(payloadBytes, at);
  at += payloadBytes.byteLength;
  out.set(CBOR_KEY_ORIGIN, at);
  at = writeCborTextHead(out, at + CBOR_KEY_ORIGIN.length, originLen);
  at = writeUtf8(out, at, originId, originLen);
  out.set(CBOR_KEY_SEAL, at);
  at += CBOR_KEY_SEAL.length;
  out.set(CBOR_SEAL_HEAD, at);
  // Le sceau base64url est ASCII : autant d'octets que de caractères.
  writeUtf8(out, at + CBOR_SEAL_HEAD.length, sig, SEAL_CHARS);
  return out;
}

/** Encodeur UTF-8 partagé, pour les chaînes non ASCII. */
const UTF8 = new TextEncoder();

/**
 * Écrit `value` en UTF-8 à `at` ; rend la position suivante. `byteLen` égal au
 * nombre de caractères = chaîne ASCII : boucle directe, sans vue intermédiaire.
 */
function writeUtf8(
  out: Uint8Array,
  at: number,
  value: string,
  byteLen: number,
): number {
  if (byteLen === value.length) {
    for (let i = 0; i < byteLen; i += 1) out[at + i] = value.charCodeAt(i);
  } else {
    UTF8.encodeInto(value, out.subarray(at, at + byteLen));
  }
  return at + byteLen;
}

/** Verdicts déjà CONSTATÉS, par codec (un serveur n'en a qu'un : la case unique suffit). */
let framedCodec: IFrameCodec | null = null;
let framedVerdict = false;
const framedVerdicts = new WeakMap<IFrameCodec, boolean>();

/**
 * Le codec écrit-il le CBOR le plus court, celui que {@link frameSealedBytes}
 * assemble ? CONSTATÉ, jamais déduit de son nom : une enveloppe d'épreuve est
 * encodée par le codec et comparée à l'assemblage par fragments, une fois par
 * codec. Faux → le codec garde la voie générique (double encodage), qui reste
 * correcte pour n'importe quel format.
 */
function framesAsCbor(codec: IFrameCodec): boolean {
  if (codec === framedCodec) return framedVerdict;
  let verdict = framedVerdicts.get(codec);
  if (verdict === undefined) {
    verdict = probeFraming(codec);
    framedVerdicts.set(codec, verdict);
  }
  framedCodec = codec;
  framedVerdict = verdict;
  return verdict;
}

/** Épreuve de {@link framesAsCbor} : chaque longueur d'en-tête utile, octets compris. */
function probeFraming(codec: IFrameCodec): boolean {
  const channel = "é".repeat(20);
  const originId = "pod";
  const payload = {
    seq: 7,
    list: [1, -2.5, null, "x"],
    raw: new Uint8Array([0, 255]),
  };
  const sig = "A".repeat(SEAL_CHARS);
  try {
    const expected = encodeBytes(codec, { channel, payload, originId, sig });
    return asBuffer(expected).equals(
      asBuffer(
        frameSealedBytes(channel, originId, encodeBytes(codec, payload), sig),
      ),
    );
  } catch {
    return false;
  }
}

/**
 * Encode un message backplane pour le **sujet binaire** du bus (ADR-0021 S6) :
 * la MÊME enveloppe `{ channel, payload, originId }`, encodée par le codec
 * binaire du serveur, octets natifs dans `payload`, scellée si un secret est
 * fourni.
 *
 * Scellée, la charge est encodée UNE fois : le sceau se calcule sur ses octets,
 * et l'enveloppe s'assemble autour d'eux. Un codec qui n'écrit pas le CBOR le plus
 * court (constaté, cf {@link framesAsCbor}) encode l'enveloppe entière une seconde
 * fois — correct pour tout format, plus coûteux.
 *
 * @param msg - message à transporter (canal, charge, origine).
 * @param codec - le codec binaire du serveur (`CBOR_FRAME_CODEC` de `nodefony/cbor`).
 * @param secret - secret partagé entre pods ; `null`/`undefined` → enveloppe nue.
 * @returns les octets à publier sur le sujet binaire.
 * @throws TypeError si le codec rend du texte.
 */
export function sealBackplaneEnvelopeBytes(
  msg: IBackplaneMessage,
  codec: IFrameCodec,
  secret?: string | null,
): Uint8Array {
  // Une charge absente voyage `null`, comme sous sceau sur la voie texte.
  const payload = msg.payload ?? null;
  if (!secret)
    return encodeBytes(codec, {
      channel: msg.channel,
      payload,
      originId: msg.originId,
    });
  const payloadBytes = encodeBytes(codec, payload);
  const sig = sealText(
    sealHead(JSON.stringify(msg.originId), JSON.stringify(msg.channel)),
    payloadBytes,
    secret,
  );
  if (framesAsCbor(codec))
    return frameSealedBytes(msg.channel, msg.originId, payloadBytes, sig);
  return encodeBytes(codec, {
    channel: msg.channel,
    payload,
    originId: msg.originId,
    [SEAL_FIELD]: sig,
  });
}

/**
 * Tranche de la charge dans une enveloppe binaire reçue, si elle a EXACTEMENT la
 * forme qu'assemble {@link frameSealedBytes} pour ce canal, cette origine et ce
 * sceau ; `null` sinon (forme tierce → repli). Aucune copie : une vue.
 */
function receivedPayloadBytes(
  raw: Uint8Array,
  channel: string,
  originId: string,
  provided: string,
): Uint8Array | null {
  if (provided.length !== SEAL_CHARS || raw[0] !== CBOR_MAP_4) return null;
  const channelLen = Buffer.byteLength(channel, "utf8");
  const originLen = Buffer.byteLength(originId, "utf8");
  const channelHeadAt = 1 + CBOR_KEY_CHANNEL.length;
  const payloadKeyAt =
    channelHeadAt + cborTextHeadSize(channelLen) + channelLen;
  const start = payloadKeyAt + CBOR_KEY_PAYLOAD.length;
  const originAt =
    raw.length -
    CBOR_SEAL_TAIL_LEN -
    originLen -
    cborTextHeadSize(originLen) -
    CBOR_KEY_ORIGIN.length;
  if (originAt <= start) return null;
  const originHeadAt = originAt + CBOR_KEY_ORIGIN.length;
  const sealKeyAt = originHeadAt + cborTextHeadSize(originLen) + originLen;
  return bytesAt(raw, 1, CBOR_KEY_CHANNEL) &&
    cborTextHeadAt(raw, channelHeadAt, channelLen) &&
    bytesAt(raw, payloadKeyAt, CBOR_KEY_PAYLOAD) &&
    bytesAt(raw, originAt, CBOR_KEY_ORIGIN) &&
    cborTextHeadAt(raw, originHeadAt, originLen) &&
    bytesAt(raw, sealKeyAt, CBOR_KEY_SEAL) &&
    bytesAt(raw, sealKeyAt + CBOR_KEY_SEAL.length, CBOR_SEAL_HEAD)
    ? raw.subarray(start, originAt)
    : null;
}

/**
 * Décode et **vérifie** une enveloppe reçue sur le sujet binaire du bus — même
 * règle que {@link openBackplaneEnvelope} : fail-closed strict sous un secret,
 * aucun downgrade en retirant `sig`.
 *
 * Le sceau se vérifie sur la tranche REÇUE de la charge quand l'enveloppe a la
 * forme qu'assemble l'émetteur — aucun ré-encodage ; une autre forme retombe sur
 * le ré-encodage de la charge décodée (le codec CBOR du cœur rend la forme la plus
 * courte de chaque valeur, donc émetteur et récepteur signent les mêmes octets).
 *
 * @param raw - octets lus sur le sujet binaire.
 * @param codec - le codec binaire du serveur.
 * @param secret - secret partagé attendu, ou `null`/`undefined` si aucun.
 * @returns le message vérifié, ou `null` s'il doit être ignoré.
 */
export function openBackplaneEnvelopeBytes(
  raw: Uint8Array,
  codec: IFrameCodec,
  secret?: string | null,
): IBackplaneMessage | null {
  let parsed: unknown;
  try {
    parsed = codec.decode(raw);
  } catch {
    return null; // octets illisibles sur un canal partagé
  }
  if (!isEnvelope(parsed)) return null;
  const msg: IBackplaneMessage = {
    channel: parsed.channel,
    payload: parsed.payload === null ? undefined : parsed.payload,
    originId: parsed.originId,
  };
  if (!secret) return msg;
  const provided = parsed[SEAL_FIELD];
  if (typeof provided !== "string") return null;
  const head = sealHead(
    JSON.stringify(msg.originId),
    JSON.stringify(msg.channel),
  );
  if (framesAsCbor(codec)) {
    const slice = receivedPayloadBytes(
      raw,
      msg.channel,
      msg.originId,
      provided,
    );
    if (slice !== null && sealMatches(provided, sealText(head, slice, secret)))
      return msg;
  }
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = encodeBytes(codec, parsed.payload ?? null);
  } catch {
    return null;
  }
  return sealMatches(provided, sealText(head, payloadBytes, secret))
    ? msg
    : null;
}

// ---------------------------------------------------------------------------
// Écho
// ---------------------------------------------------------------------------

/**
 * Reconnaît l'**écho** d'un pod — ce que le bus lui renvoie de ses propres
 * publications — à la FIN du message, sans le décoder (ADR-0021 S6, ADR-0025).
 *
 * Un bus pub/sub comme Redis rend à l'émetteur chacune de ses publications : sur un
 * pod chargé, c'est un message reçu sur deux, et la présence répartie en fait un
 * signal (le bus est vivant tant que l'écho revient). Le reconnaître coûte, sous un
 * secret, UN HMAC sur la tranche de la charge : ni `JSON.parse`, ni décodage CBOR.
 *
 * Sous un secret, l'écho est VÉRIFIÉ avant d'être compté : un tiers qui forgerait
 * l'origine de ce pod pour simuler un bus vivant échoue au sceau. Sans secret, rien
 * ne peut l'être — le bus est ouvert, et le wiring l'annonce au démarrage.
 *
 * Un message que ce lecteur ne reconnaît pas (forme tierce, sceau faux) n'est PAS
 * jeté : il suit la voie ordinaire, qui le vérifie en entier.
 */
export class BackplaneEcho {
  readonly #secret: string | null;
  /** `originId\n` en JSON : début de la chaîne canonique de CE pod. */
  readonly #sealHeadStart: string;
  /** Texte, scellé : `,"originId":<origine>,"sig":"`. */
  readonly #textTail: string;
  /** Texte, nu : `,"originId":<origine>}`. */
  readonly #textBareTail: string;
  /** CBOR : clé `originId` puis la chaîne de l'origine. */
  readonly #bytesOrigin: Uint8Array;
  /** Lecture d'un en-tête de chaîne CBOR, réutilisée (aucune allocation par message). */
  readonly #head: [number, number] = [0, 0];

  /**
   * @param originId - identité de CE pod sur le bus.
   * @param secret - secret partagé, ou `null` sur un bus non scellé.
   */
  constructor(originId: string, secret: string | null) {
    this.#secret = secret;
    const originIdJson = JSON.stringify(originId);
    this.#sealHeadStart = `${originIdJson}\n`;
    this.#textTail = TEXT_ORIGIN_KEY + originIdJson + TEXT_SEAL_KEY;
    this.#textBareTail = `${TEXT_ORIGIN_KEY}${originIdJson}}`;
    const origin = cborText(originId);
    this.#bytesOrigin = new Uint8Array(CBOR_KEY_ORIGIN.length + origin.length);
    this.#bytesOrigin.set(CBOR_KEY_ORIGIN, 0);
    this.#bytesOrigin.set(origin, CBOR_KEY_ORIGIN.length);
  }

  /**
   * Ce message texte est-il l'écho de ce pod (sceau vérifié sous un secret) ?
   *
   * @param raw - message brut lu sur le sujet texte.
   */
  text(raw: string): boolean {
    const secret = this.#secret;
    if (secret === null) return raw.endsWith(this.#textBareTail);
    const tail = this.#textTail;
    const tailAt = raw.length - TEXT_SEAL_END_LEN - SEAL_CHARS - tail.length;
    if (
      tailAt <= TEXT_HEAD_LEN ||
      !raw.startsWith(tail, tailAt) ||
      !raw.endsWith(TEXT_SEAL_END) ||
      !raw.startsWith(TEXT_HEAD) ||
      raw.charCodeAt(TEXT_HEAD_LEN) !== QUOTE
    )
      return false;
    const close = raw.indexOf(TEXT_CHANNEL_CLOSE, TEXT_HEAD_LEN + 1);
    const start = close + TEXT_CHANNEL_CLOSE_LEN;
    if (close < 0 || start >= tailAt) return false;
    const sealAt = tailAt + tail.length;
    return sealMatches(
      raw.slice(sealAt, sealAt + SEAL_CHARS),
      sealText(
        `${this.#sealHeadStart}${raw.slice(TEXT_HEAD_LEN, close + 1)}\n`,
        raw.slice(start, tailAt),
        secret,
      ),
    );
  }

  /**
   * Ce message binaire est-il l'écho de ce pod (sceau vérifié sous un secret) ?
   *
   * @param raw - octets lus sur le sujet binaire.
   * @param codec - le codec binaire du serveur ; un codec qui n'écrit pas le CBOR
   *   attendu (cf {@link framesAsCbor}) laisse tout message à la voie ordinaire.
   */
  bytes(raw: Uint8Array, codec: IFrameCodec): boolean {
    if (!framesAsCbor(codec)) return false;
    const origin = this.#bytesOrigin;
    const secret = this.#secret;
    if (secret === null)
      return (
        raw[0] === CBOR_MAP_3 &&
        bytesAt(raw, raw.length - origin.length, origin)
      );
    const originAt = raw.length - CBOR_SEAL_TAIL_LEN - origin.length;
    const sealKeyAt = originAt + origin.length;
    const head = this.#head;
    if (
      raw[0] !== CBOR_MAP_4 ||
      !bytesAt(raw, originAt, origin) ||
      !bytesAt(raw, sealKeyAt, CBOR_KEY_SEAL) ||
      !bytesAt(raw, sealKeyAt + CBOR_KEY_SEAL.length, CBOR_SEAL_HEAD) ||
      !bytesAt(raw, 1, CBOR_KEY_CHANNEL) ||
      !readCborTextHead(raw, 1 + CBOR_KEY_CHANNEL.length, head)
    )
      return false;
    const channelAt = 1 + CBOR_KEY_CHANNEL.length + head[1];
    const channelEnd = channelAt + head[0];
    const start = channelEnd + CBOR_KEY_PAYLOAD.length;
    if (start >= originAt || !bytesAt(raw, channelEnd, CBOR_KEY_PAYLOAD))
      return false;
    const view = asBuffer(raw);
    return sealMatches(
      view.toString("latin1", raw.length - SEAL_CHARS, raw.length),
      sealText(
        `${this.#sealHeadStart}${JSON.stringify(view.toString("utf8", channelAt, channelEnd))}\n`,
        raw.subarray(start, originAt),
        secret,
      ),
    );
  }
}
