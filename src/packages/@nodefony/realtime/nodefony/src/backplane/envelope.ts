import { createHmac, timingSafeEqual } from "node:crypto";
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
 * La forme signée est la re-sérialisation de la charge par le récepteur ; elle
 * n'est PAS promise comme contrat à un producteur écrit dans un autre langage.
 */

/** Nom du champ portant le sceau dans l'enveloppe sérialisée. */
const SEAL_FIELD = "sig";

/** Enveloppe transportée : le message + son sceau optionnel. */
interface SealedEnvelope extends IBackplaneMessage {
  /** HMAC base64url de la chaîne canonique ; absent si aucun secret n'est posé. */
  [SEAL_FIELD]?: string;
}

/**
 * Sceau HMAC-SHA256 (base64url) d'un triplet **déjà sérialisé**. Le `\n` sépare
 * trois fragments JSON : les deux premiers sont des chaînes échappées, donc
 * aucun décalage de frontière n'est possible entre les parties.
 *
 * Prend les fragments et non le message : la charge n'est sérialisée **qu'une
 * fois** par publication (elle sert et au sceau et à l'enveloppe finale) — sur
 * un canal de fan-out, une seconde sérialisation par message se paierait à
 * chaque diffusion.
 */
function seal(
  originIdJson: string,
  channelJson: string,
  payloadJson: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${originIdJson}\n${channelJson}\n${payloadJson}`)
    .digest("base64url");
}

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
  const sig = seal(originIdJson, channelJson, payloadJson, secret);
  return `{"channel":${channelJson},"payload":${payloadJson},"originId":${originIdJson},"${SEAL_FIELD}":"${sig}"}`;
}

/** Type-guard d'enveloppe — narrowing sûr d'un message brut venu du bus. */
function isEnvelope(m: unknown): m is SealedEnvelope {
  return (
    typeof ownField(m, "channel") === "string" &&
    typeof ownField(m, "originId") === "string"
  );
}

/**
 * Parse et **vérifie** une enveloppe reçue du bus partagé.
 *
 * Fail-closed strict quand un secret est posé : une enveloppe sans sceau ou au
 * sceau invalide est rejetée — **aucun downgrade** possible en retirant le champ
 * `sig`. Sans secret, l'enveloppe nue est acceptée (compat ; l'alerte de boot qui
 * signale ce mode non authentifié est portée par le wiring du driver).
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
    // charge ABSENTE, rendue `undefined` comme sur les autres bus. Le sceau ci-dessous
    // se recalcule à l'identique (`undefined` se signe `null`).
    payload: parsed.payload === null ? undefined : parsed.payload,
    originId: parsed.originId,
  };
  if (!secret) return msg;
  const provided = parsed[SEAL_FIELD];
  if (typeof provided !== "string") return null; // secret exigé → sceau obligatoire
  // Re-sérialisation des fragments pour recalculer le sceau : `JSON.stringify`
  // est stable sur la sortie de `JSON.parse` (ordre des clés préservé, forme
  // numérique canonique), donc l'émetteur et le receveur signent la même chaîne.
  // `undefined` pour une charge `undefined` — le type standard ne le dit pas.
  const payloadText = JSON.stringify(msg.payload) as string | undefined;
  const expected = seal(
    JSON.stringify(msg.originId),
    JSON.stringify(msg.channel),
    payloadText ?? "null",
    secret,
  );
  return sameSeal(provided, expected) ? msg : null;
}

/**
 * Compare deux sceaux base64url à temps constant.
 *
 * Longueurs différentes → `timingSafeEqual` lève ; on tranche avant (la longueur
 * du sceau n'est pas un secret : c'est celle de SHA-256).
 */
function sameSeal(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "base64url");
  const b = Buffer.from(expected, "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sceau d'une enveloppe BINAIRE : la même chaîne canonique que le texte, où le
 * troisième fragment est la charge ENCODÉE par le codec au lieu de son JSON.
 * Les deux premiers fragments restent des chaînes JSON échappées : aucun
 * décalage de frontière n'est possible, et la charge, en dernier, n'a pas de
 * frontière à garder.
 */
function sealBytes(
  originId: string,
  channel: string,
  payloadBytes: Uint8Array,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${JSON.stringify(originId)}\n${JSON.stringify(channel)}\n`)
    .update(payloadBytes)
    .digest("base64url");
}

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
 * Encode un message backplane pour le **sujet binaire** du bus (ADR-0021 S6) :
 * la MÊME enveloppe `{ channel, payload, originId }`, encodée par le codec
 * binaire du serveur, octets natifs dans `payload`, scellée si un secret est
 * fourni.
 *
 * Scellée, la charge est encodée deux fois — une pour le sceau, une dans
 * l'enveloppe : le codec générique ne permet pas d'assembler l'enveloppe à
 * partir de fragments déjà encodés, comme le fait la voie texte.
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
  const sig = sealBytes(
    msg.originId,
    msg.channel,
    encodeBytes(codec, payload),
    secret,
  );
  return encodeBytes(codec, {
    channel: msg.channel,
    payload,
    originId: msg.originId,
    [SEAL_FIELD]: sig,
  });
}

/**
 * Décode et **vérifie** une enveloppe reçue sur le sujet binaire du bus — même
 * règle que {@link openBackplaneEnvelope} : fail-closed strict sous un secret,
 * aucun downgrade en retirant `sig`.
 *
 * Le sceau se recalcule sur le RÉ-ENCODAGE de la charge décodée, comme la voie
 * texte le fait sur sa re-sérialisation : le codec CBOR du cœur rend la forme la
 * plus courte de chaque valeur, donc émetteur et récepteur signent les mêmes
 * octets.
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
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = encodeBytes(codec, parsed.payload ?? null);
  } catch {
    return null;
  }
  return sameSeal(
    provided,
    sealBytes(msg.originId, msg.channel, payloadBytes, secret),
  )
    ? msg
    : null;
}
