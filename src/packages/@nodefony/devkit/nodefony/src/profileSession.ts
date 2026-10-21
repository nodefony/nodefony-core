import { isLocalAddress } from "@nodefony/ai";
import type { ContextType } from "@nodefony/http";
import type { ProfileTicketStore } from "./profileTicket";

/**
 * Facteur d'authentification déclaré au flux de session : l'audit écrit
 * `login.success` avec cette raison, ce qui distingue une session de profilage
 * d'une vraie connexion.
 */
export const PROFILE_SESSION_FACTOR = "devkit";

/** Message unique de tout refus : la cause fine ne sort jamais vers l'appelant. */
export const PROFILE_SESSION_REFUSED = "ticket de profilage refusé";

/** Ce que la route reçoit, tel que la requête le présente. */
export interface IProfileSessionRequest {
  /** Valeur de l'en-tête du ticket, non fiable. */
  readonly ticket: unknown;
  /** Adresse distante de la connexion. */
  readonly remoteAddress: string | undefined;
}

/** Compte pour lequel la session vient d'être ouverte. */
export interface IProfileSessionUser {
  readonly identifier: string;
  readonly roles?: readonly string[] | undefined;
}

/** Ce dont la décision a besoin, fourni par le contrôleur. */
export interface IProfileSessionDeps {
  /** Magasin des tickets, `null` si aucun n'a jamais été émis. */
  readonly tickets: ProfileTicketStore | null;
  /**
   * Ouvre la session pour `identifier` par le flux de session de l'application,
   * `null` quand aucun n'est installé. Lève si le compte est inconnu ou refusé.
   */
  readonly establish:
    ((identifier: string) => Promise<IProfileSessionUser>) | null;
  /** Pseudonyme public de la session ouverte, `null` si aucune ne l'est. */
  readonly sessionRef: () => string | null;
}

/** Verdict de la route : la session ouverte, ou un refus. */
export type ProfileSessionVerdict =
  | {
      readonly status: 200;
      readonly identifier: string;
      readonly roles: readonly string[];
      readonly ref: string;
    }
  | { readonly status: 403 | 503; readonly message: string };

const REFUSED = { status: 403, message: PROFILE_SESSION_REFUSED } as const;

/**
 * Décide l'ouverture d'une session de profilage.
 *
 * Ordre délibéré : la localité, puis la présence d'un flux de session, et
 * seulement ensuite le rachat du ticket — un appel qui ne peut pas aboutir ne
 * consomme pas le ticket. L'identité vient du TICKET, jamais de la requête.
 *
 * @param request - le ticket présenté et l'adresse de l'appelant.
 * @param deps - magasin de tickets et flux de session.
 * @returns `200` avec le compte et le pseudonyme de session, `403` uniforme, ou
 *   `503` quand l'application n'a pas de flux de session.
 */
export async function openProfileSession(
  request: IProfileSessionRequest,
  deps: IProfileSessionDeps,
): Promise<ProfileSessionVerdict> {
  if (!isLocalAddress(request.remoteAddress)) return REFUSED;
  if (deps.establish === null) {
    return {
      status: 503,
      message:
        "aucun flux de session : le profilage authentifié exige @nodefony/security",
    };
  }
  const identifier = deps.tickets?.redeem(request.ticket) ?? null;
  if (identifier === null) return REFUSED;
  let user: IProfileSessionUser;
  try {
    user = await deps.establish(identifier);
  } catch {
    return REFUSED;
  }
  const ref = deps.sessionRef();
  if (ref === null) {
    return {
      status: 503,
      message: "session de profilage non ouverte par le flux de session",
    };
  }
  return {
    status: 200,
    identifier: user.identifier,
    roles: user.roles ?? [],
    ref,
  };
}

/**
 * Vue minimale du flux de session (`authFlow`, fourni par `@nodefony/security`).
 * Ce module n'en dépend pas : il disparaît en production, elle non.
 */
export interface IProfileSessionFlow {
  establishSessionFor(
    context: ContextType,
    identifier: string,
    reason?: string,
  ): Promise<unknown>;
}

/** Vue minimale du service de sessions (`sessions`, `@nodefony/http`). */
export interface IProfileSessionStore {
  /** Pseudonyme public d'une session, non réversible. */
  sessionRef(id: string): string;
  /** Détruit la session désignée par son pseudonyme. */
  destroyByRef(ref: string, actor?: string | null): Promise<boolean>;
}

/**
 * Le service résolu est-il un flux de session utilisable ?
 *
 * @param value - service lu dans le conteneur.
 * @returns `true` s'il ouvre une session pour une identité prouvée.
 */
export function isProfileSessionFlow(
  value: unknown,
): value is IProfileSessionFlow {
  return (
    typeof value === "object" &&
    value !== null &&
    "establishSessionFor" in value &&
    typeof value.establishSessionFor === "function"
  );
}

/**
 * Le service résolu est-il un service de sessions utilisable ?
 *
 * @param value - service lu dans le conteneur.
 * @returns `true` s'il dérive un pseudonyme et détruit une session par lui.
 */
export function isProfileSessionStore(
  value: unknown,
): value is IProfileSessionStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionRef" in value &&
    typeof value.sessionRef === "function" &&
    "destroyByRef" in value &&
    typeof value.destroyByRef === "function"
  );
}

/**
 * Lit le compte rendu par le flux de session, sans lui faire confiance.
 *
 * @param value - retour de `establishSessionFor`.
 * @param identifier - identité du ticket, retenue si le retour n'en porte pas.
 * @returns l'identifiant et les rôles chaîne du compte.
 */
export function toProfileSessionUser(
  value: unknown,
  identifier: string,
): IProfileSessionUser {
  if (typeof value !== "object" || value === null) return { identifier };
  const found =
    "identifier" in value && typeof value.identifier === "string"
      ? value.identifier
      : identifier;
  const roles =
    "roles" in value && Array.isArray(value.roles)
      ? value.roles.filter((r: unknown): r is string => typeof r === "string")
      : [];
  return { identifier: found, roles };
}
