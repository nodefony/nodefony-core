import type { ISubscriberIdentity } from "./channelAdmission";
import type { EventsMap } from "./RealtimeEventMap";

/**
 * Préfixe du canal PERSONNEL d'une identité — `user:<id>`, la brique « livrer à une personne » (ADR-0022 §6, D1).
 *
 * Le canal est servi, gardé et diffusé entre serveurs par le framework : une
 * application n'y déclare rien. Elle peut toutefois y écrire sa propre politique
 * (`user:*`, `user:public`), qui l'emporte alors sur la règle intégrée.
 */
export const USER_CHANNEL_PREFIX = "user:";

/**
 * Nom du canal personnel d'une identité : `user:<id>`.
 *
 * @param userId - l'`id` STABLE et opaque du compte (`RealtimeIdentity.id`),
 *   jamais le login : un login libéré se réattribue, et le nouveau compte
 *   recevrait les messages de l'ancien.
 * @returns le nom exact du canal.
 */
export function userChannel(userId: string): string {
  return `${USER_CHANNEL_PREFIX}${userId}`;
}

/**
 * Règle d'admission du canal personnel : `who` n'entre que sur SON canal, par égalité de chaîne avec `user:<son id>`.
 *
 * Égalité, jamais découpage : un `:` dans un identifiant (`<émetteur>#<sujet>`,
 * un `id` d'annuaire) ne peut pas tromper une comparaison de chaînes entières.
 * Ne lit que l'identité du demandeur, jamais une base : `user:999` (inexistant)
 * et `user:bob` (pas le sien) rendent le MÊME refus — ni oracle d'existence, ni
 * oracle de présence. L'anonyme est refusé (`id === null`, et la file
 * d'admission l'écarte avant même d'appeler la règle).
 *
 * Pure et isomorphe : la même règle sert la socket, et servira le flux SSE et
 * l'abonnement webhook, qui reçoivent la même identité d'admission.
 *
 * @param channel - nom exact du canal demandé.
 * @param who - identité d'admission gelée du demandeur.
 * @returns `true` si `channel` est le canal personnel de `who`.
 */
export function isOwnUserChannel(
  channel: string,
  who: ISubscriberIdentity,
): boolean {
  return (
    who.authenticated && who.id !== null && channel === userChannel(who.id)
  );
}

/**
 * Charge du canal personnel déclarée par une carte d'événements — la valeur de sa clé gabarit `` [k: `user:${string}`]: … ``, `never` si la carte n'en déclare pas.
 *
 * `never` est voulu : une application qui veut livrer à une personne déclare la
 * forme du message dans son contrat, sinon `publishToUser` ne compile pas.
 *
 * @typeParam M - carte d'événements (côté serveur : `ContractServerEmit<C>` ;
 *   côté client : la carte d'écoute de la socket).
 */
export type UserChannelPayload<M extends EventsMap> =
  // Par la présence de la CLÉ, jamais par `M extends { [k: …]: infer P }` :
  // un type littéral sans index y est assignable (index implicite), et une
  // carte qui ne déclare pas le canal personnel l'accepterait avec `unknown`.
  `user:${string}` extends keyof M ? M[`user:${string}`] : never;
