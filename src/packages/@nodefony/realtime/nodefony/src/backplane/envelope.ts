import { createHmac, timingSafeEqual } from "node:crypto";
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
 * canal (`chat:` → `security:audit`), ni substitution de charge.
 *
 * Hors portée (assumé, cf sémantique at-most-once du port) : le **rejeu**. Un
 * tiers qui lit le bus peut re-publier un message scellé intact ; l'effet se
 * limite à re-diffuser une charge déjà diffusée sur un canal déjà broadcast, que
 * le client realtime re-synchronise. Un anti-rejeu (horodatage + fenêtre) exigerait
 * des horloges alignées entre pods pour un gain nul face à ce modèle de menace.
 */

/** Nom du champ portant le sceau dans l'enveloppe sérialisée. */
const SEAL_FIELD = "sig";

/** Enveloppe transportée : le message + son sceau optionnel. */
interface SealedEnvelope extends IBackplaneMessage {
  /** HMAC base64url de la chaîne canonique ; absent si aucun secret n'est posé. */
  [SEAL_FIELD]?: string;
}

/**
 * Chaîne canonique signée. Le `\n` sépare des champs dont deux sont libres
 * (`originId`, `channel`) : le canal étant sérialisé en JSON (donc échappé), aucun
 * décalage de frontière n'est possible entre les trois parties.
 */
function canonical(msg: IBackplaneMessage): string {
  return `${JSON.stringify(msg.originId)}\n${JSON.stringify(msg.channel)}\n${JSON.stringify(msg.payload) ?? "null"}`;
}

/** Calcule le sceau HMAC-SHA256 (base64url) d'un message. */
function seal(msg: IBackplaneMessage, secret: string): string {
  return createHmac("sha256", secret)
    .update(canonical(msg))
    .digest("base64url");
}

/**
 * Sérialise un message backplane, scellé si un secret est fourni.
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
  const env: SealedEnvelope = { ...msg, [SEAL_FIELD]: seal(msg, secret) };
  return JSON.stringify(env);
}

/** Type-guard d'enveloppe — narrowing sûr d'un message brut venu du bus. */
function isEnvelope(m: unknown): m is SealedEnvelope {
  if (typeof m !== "object" || m === null) return false;
  const e = m as Partial<SealedEnvelope>;
  return typeof e.channel === "string" && typeof e.originId === "string";
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
    payload: parsed.payload,
    originId: parsed.originId,
  };
  if (!secret) return msg;
  const provided = parsed[SEAL_FIELD];
  if (typeof provided !== "string") return null; // secret exigé → sceau obligatoire
  const expected = seal(msg, secret);
  const a = Buffer.from(provided, "base64url");
  const b = Buffer.from(expected, "base64url");
  // Longueurs différentes → timingSafeEqual throw ; on tranche avant (la longueur
  // du sceau n'est pas un secret : c'est celle de SHA-256).
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return msg;
}
