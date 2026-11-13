/**
 * Les salons — règles PURES, lues À L'IDENTIQUE par la page et le serveur :
 * le nom du canal d'un salon, qui peut y entrer, et ce qu'un salon montre de
 * lui-même.
 *
 * Guide pour un agent : la décision d'admission vit ICI, sans base ni socket ;
 * le serveur lui donne les faits lus en base (`RoomService.admissionFacts`)
 * et la classe d'admission du canal (`RoomAdmission`) rend son verdict. La
 * page l'emploie pour l'affichage seulement — le serveur décide toujours.
 * Le modèle vient d'une salle de conférence (membres, événements planifiés,
 * invités) : un même salon sert un chat ou une conférence (`kind`).
 * Doc : `@nodefony/realtime/docs/canaux-a-membres.md`.
 */

/** Le canal d'un salon : `chat:room:<id>`. */
export const ROOM_CHANNEL_PREFIX = "chat:room:";

/** Le motif déclaré une fois pour tous les salons. */
export const ROOM_CHANNEL_PATTERN = "chat:room:*";

/** Le salon public semé au premier démarrage, et son identifiant stable. */
export const LOBBY_ROOM_ID = "salon";

/** Un invité entre quinze minutes avant le début de l'événement. */
export const INVITE_EARLY_MS = 15 * 60_000;

/** La nature d'un salon. */
export type RoomKind = "chat" | "conference";
/** Qui peut entrer sans y être invité. */
export type RoomAccess = "public" | "private";
/** Le rôle d'un membre. */
export type RoomRole = "owner" | "moderator" | "member";
/** L'état d'un événement (iCalendar `STATUS`). */
export type EventStatus = "tentative" | "confirmed" | "cancelled";
/** La réponse d'un invité (iCalendar `PARTSTAT`). */
export type Partstat = "needs-action" | "accepted" | "declined" | "tentative";

/** Le canal d'un salon. */
export function roomChannel(roomId: string): string {
  return `${ROOM_CHANNEL_PREFIX}${roomId}`;
}

/** Le salon d'un canal, ou `null` si ce n'est pas un canal de salon. */
export function roomIdOf(channel: string): string | null {
  if (!channel.startsWith(ROOM_CHANNEL_PREFIX)) return null;
  const id = channel.slice(ROOM_CHANNEL_PREFIX.length);
  return id === "" || id.includes(":") ? null : id;
}

/** Une invitation de la personne à un événement du salon. */
export interface IInvitation {
  start: number;
  end: number;
  status: EventStatus;
  partstat: Partstat;
}

/** Ce que la base dit d'un salon et d'une personne, pour décider. */
export interface IAdmissionFacts {
  /** Le salon ; `null` s'il n'existe pas. */
  room: { access: RoomAccess; locked: boolean } | null;
  /** La personne est-elle membre du salon ? */
  member: boolean;
  /** Ses invitations aux événements du salon. */
  invitations: readonly IInvitation[];
}

/** Pourquoi une personne entre — ou `"refused"`. */
export type AdmissionVerdict = "member" | "public" | "invited" | "refused";

/** L'invitation ouvre-t-elle la porte à cet instant ? */
export function isLiveInvitation(invite: IInvitation, now: number): boolean {
  return (
    invite.status !== "cancelled" &&
    invite.partstat !== "declined" &&
    now >= invite.start - INVITE_EARLY_MS &&
    now <= invite.end
  );
}

/**
 * Qui entre dans un salon, dans cet ordre : un MEMBRE (même salon verrouillé),
 * tout le monde dans un salon PUBLIC non verrouillé, un INVITÉ d'un événement
 * en cours (quinze minutes avant le début jusqu'à la fin, invitation ni
 * déclinée ni annulée). Un salon inconnu refuse.
 *
 * @param facts - ce que la base dit du salon et de la personne
 * @param now - l'instant de la décision, en ms
 */
// #region rooms-rule
export function admissionOf(
  facts: IAdmissionFacts,
  now: number,
): AdmissionVerdict {
  if (facts.room === null) return "refused";
  if (facts.member) return "member";
  if (facts.room.access === "public" && !facts.room.locked) return "public";
  if (facts.invitations.some((invite) => isLiveInvitation(invite, now)))
    return "invited";
  return "refused";
}
// #endregion

/** Un événement tel que le salon l'annonce. */
export interface IRoomEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  status: EventStatus;
  /**
   * La réponse de la personne qui regarde ; `null` si elle n'est pas invitée.
   * `"needs-action"` : la page lui propose d'accepter ou de décliner.
   */
  partstat: Partstat | null;
}

/** Un salon, tel qu'une personne le voit dans sa liste. */
export interface IRoomView {
  id: string;
  name: string;
  kind: RoomKind;
  access: RoomAccess;
  locked: boolean;
  description: string | null;
  /** Le rôle de la personne ; `null` si elle n'est pas membre. */
  role: RoomRole | null;
  /** L'événement en cours ou le prochain, s'il y en a un. */
  event: IRoomEvent | null;
  /**
   * Un salon à deux : le nom de L'AUTRE personne, sous lequel la page
   * l'affiche ; `null` pour un salon ordinaire.
   */
  peer: string | null;
}

// #region rooms-forms-rules
/** Un nom de salon : 80 caractères au plus (la colonne `room.name`). */
export const ROOM_NAME_MAX = 80;
/** Une description : 280 caractères au plus. */
export const ROOM_DESCRIPTION_MAX = 280;
/** Une personne possède au plus dix salons : une boucle ne remplit pas la liste. */
export const ROOMS_OWNED_MAX = 10;
/** Le titre d'un événement : 120 caractères au plus. */
export const EVENT_TITLE_MAX = 120;
/** Un événement dure vingt-quatre heures au plus (24 × 3 600 000 ms). */
export const EVENT_MAX_MS = 86_400_000;
/**
 * Un début « à l'instant » reste accepté cinq minutes (5 × 60 000 ms) : le
 * formulaire a mis du temps.
 */
export const EVENT_PAST_TOLERANCE_MS = 300_000;
/** Au plus vingt invités par événement. */
export const EVENT_ATTENDEES_MAX = 20;

/**
 * Le nom d'un salon tel qu'il est enregistré : forme Unicode NFC (un « é »
 * composé et un « e » + accent deviennent le même nom), espaces de bord
 * retirés, suites d'espaces réduites à une seule.
 */
export function normalizeRoomName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** Pourquoi ce nom (déjà normalisé) est refusé ; `null` s'il convient. */
export function roomNameProblem(name: string): string | null {
  if (name === "") return "Donne un nom au salon.";
  if (name.length > ROOM_NAME_MAX)
    return `${ROOM_NAME_MAX} caractères au plus.`;
  if (name.toLowerCase().startsWith(DIRECT_PREFIX))
    return `Le préfixe « ${DIRECT_PREFIX} » est réservé aux messages privés.`;
  return null;
}

/**
 * Pourquoi ce créneau est refusé ; `null` s'il convient. La fin vient après
 * le début, l'événement dure 24 h au plus et ne commence pas dans le passé.
 *
 * @param start - le début, en ms
 * @param end - la fin, en ms
 * @param now - l'instant de la décision : celui du SERVEUR, qui décide
 */
export function eventProblem(
  start: number,
  end: number,
  now: number,
): string | null {
  if (end <= start) return "La fin doit venir après le début.";
  if (end - start > EVENT_MAX_MS) return "Un événement dure 24 h au plus.";
  if (start < now - EVENT_PAST_TOLERANCE_MS) return "Le début est déjà passé.";
  return null;
}

/** Inviter et planifier : le propriétaire et les modérateurs (XEP-0045). */
export function canManage(role: RoomRole | null): boolean {
  return role === "owner" || role === "moderator";
}

/** Seul le propriétaire nomme un modérateur. */
export function canAppoint(role: RoomRole | null, wanted: RoomRole): boolean {
  if (wanted === "owner") return false;
  return wanted === "moderator" ? role === "owner" : canManage(role);
}
// #endregion

// #region rooms-direct-key
/** Le préfixe RÉSERVÉ des salons à deux. */
export const DIRECT_PREFIX = "dm:";

/**
 * Le nom d'un salon à deux : les deux identités TRIÉES. La même paire donne
 * toujours le même nom, et la colonne `room.name` est unique : deux clics
 * simultanés ne créent qu'un salon (Matrix appelle ce marquage `is_direct`).
 * Deux identifiants de 36 caractères font 76 caractères, sous la borne.
 */
export function directKey(a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${DIRECT_PREFIX}${first}:${second}`;
}

/**
 * L'autre personne d'un salon à deux, vue par `me` ; `null` si le nom n'est
 * pas celui d'un salon à deux dont `me` fait partie. On retire SON identité
 * plutôt que de couper au `:` : un identifiant peut en contenir.
 */
export function directPeer(name: string, me: string): string | null {
  if (!name.startsWith(DIRECT_PREFIX)) return null;
  const pair = name.slice(DIRECT_PREFIX.length);
  if (pair.startsWith(`${me}:`)) return pair.slice(me.length + 1) || null;
  if (pair.endsWith(`:${me}`)) return pair.slice(0, -me.length - 1) || null;
  return null;
}
// #endregion

/**
 * L'événement à montrer dans l'en-tête d'un salon : celui en cours, sinon le
 * prochain ; un événement annulé ou terminé ne se montre pas.
 *
 * @param events - les événements du salon
 * @param now - l'instant, en ms
 */
export function headlineEvent<T extends Omit<IRoomEvent, "partstat">>(
  events: readonly T[],
  now: number,
): T | null {
  let next: T | null = null;
  for (const event of events) {
    if (event.status === "cancelled" || event.end < now) continue;
    if (event.start <= now) return event;
    if (next === null || event.start < next.start) next = event;
  }
  return next;
}
