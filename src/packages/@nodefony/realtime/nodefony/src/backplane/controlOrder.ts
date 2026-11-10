import { ownField } from "nodefony";

/**
 * Ordres de contrôle entre serveurs — la LISTE FERMÉE de ce qui circule sur le
 * canal `PLATFORM_BUS_CHANNELS.control` (ADR-0022 §6 décision 4).
 *
 * Un ordre ne fait qu'ENLEVER : terminer un canal, éjecter un compte d'un
 * canal. Aucun n'admet — seul `allow` fait entrer. Il voyage dans la charge
 * d'un message ordinaire du bus, donc sous le sceau de l'enveloppe
 * (`envelope.ts#sealBackplaneEnvelope`), sans champ neuf dans l'enveloppe ni
 * méthode neuve dans `IBackplane` : un driver tiers le transporte sans le savoir.
 */

/** Longueur maximale d'un champ texte d'un ordre (nom de canal, identifiant de compte). */
export const MAX_CONTROL_FIELD_LENGTH = 1024;

/** Terminer un canal sur chaque serveur : ses membres reçoivent `realtime:closed { reason: "ended" }`. */
export interface ICloseChannelOrder {
  /** Discriminant de l'ordre. */
  readonly op: "close";
  /** Nom exact du canal. */
  readonly channel: string;
}

/** Éjecter d'un canal, sur chaque serveur, toutes les connexions d'un compte. */
export interface IEvictUserOrder {
  /** Discriminant de l'ordre. */
  readonly op: "evictUser";
  /** Nom exact du canal. */
  readonly channel: string;
  /** Identifiant du compte (`IRealtimeConnection.userId`). */
  readonly user: string;
  /**
   * Génération d'appartenance visée — RÉSERVÉE : aucun exemplaire 10.0 ne
   * l'émet, et un exemplaire qui ne sait pas s'en servir l'ignore et éjecte
   * toutes les générations (plus large, jamais moins). Elle portera en 10.x la
   * parade au rejeu d'une éjection sur un canal durable (ADR-0022 §6 d4, S-rt-48).
   */
  readonly generation?: number;
}

/** Un ordre de contrôle reconnu. */
export type ControlOrder = ICloseChannelOrder | IEvictUserOrder;

/**
 * Un texte venu du bus est-il recevable — chaîne non vide d'au plus {@link MAX_CONTROL_FIELD_LENGTH} caractères ?
 *
 * Seule borne des textes du bus (nom de canal, identifiant de compte), lue par
 * les ordres de contrôle ET par les messages de présence (ADR-0025 P2).
 *
 * @param value - champ reçu (forme inconnue).
 */
export function isBoundedBusText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CONTROL_FIELD_LENGTH
  );
}
/** Les types d'ordre que cette version sait appliquer — liste fermée. */
function isKnownOp(op: unknown): op is ControlOrder["op"] {
  return op === "close" || op === "evictUser";
}

/**
 * La charge est-elle un ordre d'un TYPE que cette version ne connaît pas — `op` lisible, mais hors de la liste fermée ?
 *
 * C'est ce qu'émet un serveur d'une version plus récente pendant un
 * déploiement progressif (ADR-0025, « Règle de lecture du bus ») : l'ordre
 * n'est pas appliqué, mais il ne se compte pas comme une injection. Rien
 * d'autre que `op` n'est lu — ses autres champs appartiennent à une version
 * qui n'est pas celle-ci. Une charge sans `op` textuel, ou d'un type CONNU de
 * forme fausse, n'est pas « inconnue » : elle est invalide.
 *
 * @param payload - la charge du message reçu (forme inconnue).
 * @returns `true` si le type d'ordre est inconnu de cette version.
 */
export function isUnknownControlOrder(payload: unknown): boolean {
  const op = ownField(payload, "op");
  return isBoundedBusText(op) && !isKnownOp(op);
}

/**
 * Lit un ordre de contrôle dans une charge venue du bus — `null` si la forme n'est pas celle d'un ordre connu.
 *
 * Une seule garde pour les deux bords : l'émetteur la passe avant de publier
 * (il n'émet jamais ce que ses pairs refuseraient), le récepteur avant
 * d'appliquer. Lecture par champs PROPRES (`ownField`) : une charge dont le
 * prototype porterait `op` ne passe pas. Un champ inconnu est toléré — c'est
 * ce qui laisse une version suivante ajouter un champ sans faire refuser ses
 * ordres pendant un déploiement progressif ; un champ CONNU de forme fausse
 * fait refuser l'ordre entier.
 *
 * @param payload - la charge du message reçu (forme inconnue).
 * @returns l'ordre, ou `null`.
 */
export function readControlOrder(payload: unknown): ControlOrder | null {
  const channel = ownField(payload, "channel");
  if (!isBoundedBusText(channel)) return null;
  const op = ownField(payload, "op");
  if (!isKnownOp(op)) return null;
  if (op === "close") return { op, channel };
  const user = ownField(payload, "user");
  if (!isBoundedBusText(user)) return null;
  const generation = ownField(payload, "generation");
  if (generation === undefined) return { op, channel, user };
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  )
    return null;
  return { op, channel, user, generation };
}
