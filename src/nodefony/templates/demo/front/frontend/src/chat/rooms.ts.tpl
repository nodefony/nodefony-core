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
}

/**
 * L'événement à montrer dans l'en-tête d'un salon : celui en cours, sinon le
 * prochain ; un événement annulé ou terminé ne se montre pas.
 *
 * @param events - les événements du salon
 * @param now - l'instant, en ms
 */
export function headlineEvent<T extends IRoomEvent>(
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
