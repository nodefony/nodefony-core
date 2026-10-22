import { z } from "zod";
import { parseModuleConfig } from "nodefony";
import type { Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { isLocalAddress } from "./guard";
import { SESSION_TICKET_HEADER, SessionTicketStore } from "./sessionTicket";

/** Message unique de tout refus : la cause fine ne sort jamais vers l'appelant. */
export const TICKET_SESSION_REFUSED = "ticket de session refusé";

/** Ce que la route reçoit, tel que la requête le présente. */
export interface ITicketSessionRequest {
  /** Valeur de l'en-tête du ticket, non fiable. */
  readonly ticket: unknown;
  /** Adresse distante de la connexion. */
  readonly remoteAddress: string | undefined;
}

/** Compte pour lequel la session vient d'être ouverte. */
export interface ITicketSessionUser {
  readonly identifier: string;
  readonly roles?: readonly string[] | undefined;
}

/** Ce dont la décision a besoin, fourni par la porte. */
export interface ITicketSessionDeps {
  /** Magasin des tickets, `null` si aucun n'a jamais été émis. */
  readonly tickets: SessionTicketStore | null;
  /**
   * Ouvre la session pour `identifier` par le flux de session de l'application,
   * `null` quand aucun n'est installé. Lève si le compte est inconnu ou refusé.
   */
  readonly establish:
    ((identifier: string) => Promise<ITicketSessionUser>) | null;
  /** Pseudonyme public de la session ouverte, `null` si aucune ne l'est. */
  readonly sessionRef: () => string | null;
  /**
   * Refuser tout appel qui ne vient pas de la machine locale. Absent = `true` :
   * le ticket ne quitte jamais le process, la boucle locale est son seul chemin.
   */
  readonly localOnly?: boolean;
}

/** Verdict de la route : la session ouverte, ou un refus. */
export type TicketSessionVerdict =
  | {
      readonly status: 200;
      readonly identifier: string;
      readonly roles: readonly string[];
      readonly ref: string;
    }
  | { readonly status: 403 | 503; readonly message: string };

const REFUSED = { status: 403, message: TICKET_SESSION_REFUSED } as const;

/**
 * Décide l'ouverture d'une session par ticket.
 *
 * Ordre délibéré : la localité, puis la présence d'un flux de session, et
 * seulement ensuite le rachat du ticket — un appel qui ne peut pas aboutir ne
 * consomme pas le ticket. L'identité vient du TICKET, jamais de la requête.
 *
 * @param request - le ticket présenté et l'adresse de l'appelant.
 * @param deps - magasin de tickets, flux de session, exigence de localité.
 * @returns `200` avec le compte et le pseudonyme de session, `403` uniforme, ou
 *   `503` quand l'application n'a pas de flux de session.
 */
export async function openTicketSession(
  request: ITicketSessionRequest,
  deps: ITicketSessionDeps,
): Promise<TicketSessionVerdict> {
  if (deps.localOnly !== false && !isLocalAddress(request.remoteAddress)) {
    return REFUSED;
  }
  if (deps.establish === null) {
    return {
      status: 503,
      message:
        "aucun flux de session : la session par ticket exige @nodefony/security",
    };
  }
  const identifier = deps.tickets?.redeem(request.ticket) ?? null;
  if (identifier === null) return REFUSED;
  let user: ITicketSessionUser;
  try {
    user = await deps.establish(identifier);
  } catch {
    return REFUSED;
  }
  const ref = deps.sessionRef();
  if (ref === null) {
    return {
      status: 503,
      message: "session par ticket non ouverte par le flux de session",
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
 * Ce module n'en dépend pas : le service se résout par NOM.
 */
export interface ISessionFlowView {
  establishSessionFor(
    context: ContextType,
    identifier: string,
    reason?: string,
  ): Promise<unknown>;
}

/** Vue minimale du service de sessions (`sessions`, `@nodefony/http`). */
export interface ISessionServiceView {
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
export function isSessionFlowView(value: unknown): value is ISessionFlowView {
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
export function isSessionServiceView(
  value: unknown,
): value is ISessionServiceView {
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
export function toTicketSessionUser(
  value: unknown,
  identifier: string,
): ITicketSessionUser {
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

/**
 * Lit, côté outil, la réponse de la route de connexion par ticket — sans lui
 * faire confiance. Vit à côté de {@link openTicketSession}, qui en produit la
 * forme : deux copies du format divergeraient.
 *
 * @param body - corps de la réponse, `null` si aucun.
 * @returns le compte et le pseudonyme de session, ou le message du refus.
 */
export function readTicketSessionVerdict(
  body: string | null,
):
  | { identifier: string; roles: readonly string[]; ref: string }
  | { message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? "");
  } catch {
    return { message: "réponse illisible" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { message: "réponse illisible" };
  }
  if (
    "identifier" in parsed &&
    typeof parsed.identifier === "string" &&
    "ref" in parsed &&
    typeof parsed.ref === "string"
  ) {
    const roles =
      "roles" in parsed && Array.isArray(parsed.roles)
        ? parsed.roles.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : [];
    return { identifier: parsed.identifier, roles, ref: parsed.ref };
  }
  return {
    message:
      "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : "réponse sans compte",
  };
}

/** Définition d'une porte de session par ticket — validée et figée au boot. */
export const ticketSessionGateSchema = z.strictObject({
  /**
   * Facteur déclaré au flux de session : l'audit écrit `login.success` avec
   * cette raison, ce qui distingue une session d'outil d'une vraie connexion.
   */
  factor: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u),
  /**
   * Refuser tout appel non local. Défaut `true` : une porte qui accepte un
   * appel distant doit l'ÉCRIRE — le ticket seul la protège alors.
   */
  localOnly: z.boolean().default(true),
});

/** Ce qu'on passe à {@link defineTicketSessionGate}. */
export type ITicketSessionGateDefinition = z.input<
  typeof ticketSessionGateSchema
>;

/** Réglages effectifs d'une porte de session par ticket. */
export type ITicketSessionGateSettings = z.output<
  typeof ticketSessionGateSchema
>;

/** Une porte de session par ticket définie — à servir depuis une action de controller. */
export interface ITicketSessionGate {
  /** Les réglages effectifs, validés et figés. */
  readonly settings: ITicketSessionGateSettings;
  /** Tickets émis, ni rachetés ni expirés. */
  readonly pending: number;
  /**
   * Émet un ticket à usage unique pour `identifier`.
   *
   * @param identifier - compte au nom duquel la session s'ouvrira.
   * @returns le ticket, à présenter dans {@link SESSION_TICKET_HEADER}.
   * @throws Error - identifiant vide, ou plafond de tickets en attente atteint.
   */
  issue(identifier: string): string;
  /**
   * Sert la requête courante d'un controller : rachète le ticket et ouvre la
   * session par le flux de l'application (`authFlow`, résolu par NOM).
   *
   * @param controller - le controller qui déclare la route (`POST`, chemin littéral).
   * @returns ce que l'action doit rendre : le verdict en JSON, à son statut.
   */
  serve(controller: Controller): Promise<unknown>;
  /**
   * Détruit une session ouverte par ticket, au nom du facteur de la porte.
   *
   * @param sessions - le service `sessions` lu dans le conteneur.
   * @param ref - pseudonyme rendu par la route.
   * @returns `true` si une session a été détruite.
   */
  close(sessions: unknown, ref: string): Promise<boolean>;
}

/**
 * Définit une porte de session par ticket : ce qui permet à un outil MCP de
 * tirer de vraies requêtes HTTP vers l'application AU NOM d'un compte.
 *
 * Une session ne s'ouvre que par le flux de session de l'application
 * (`authFlow.establishSessionFor`) : il revérifie le compte (actif, non
 * verrouillé), régénère l'identifiant et écrit l'audit. Ce flux exige une
 * requête en cours ; l'outil en envoie donc une, en boucle locale, à la route
 * que le controller déclare, et récupère le cookie que la réponse pose.
 * Fabriquer la session sans requête aurait recopié la règle de connexion.
 *
 * Comme {@link defineMcpGate}, la porte ne monte AUCUNE route : le controller
 * qui en a besoin la déclare, chemin écrit en littéral, et appelle `serve`.
 * Le magasin de tickets n'est alloué qu'au premier ticket émis.
 *
 * @param definition - facteur d'audit et exigence de localité.
 * @returns la porte, figée.
 * @throws BootConfigurationError - définition hors schéma.
 */
export function defineTicketSessionGate(
  definition: ITicketSessionGateDefinition,
): ITicketSessionGate {
  const settings = Object.freeze(
    parseModuleConfig(
      ticketSessionGateSchema,
      definition,
      "porte de session par ticket",
    ),
  );
  let tickets: SessionTicketStore | null = null;

  return {
    settings,
    get pending(): number {
      return tickets?.pending ?? 0;
    },
    issue(identifier: string): string {
      tickets ??= new SessionTicketStore();
      return tickets.issue(identifier);
    },
    async serve(controller: Controller): Promise<unknown> {
      const context = controller.context;
      if (!context?.request) {
        throw new Error("session par ticket : aucun contexte de requête");
      }
      const flow: unknown = controller.get("authFlow");
      const sessions: unknown = controller.get("sessions");
      const verdict = await openTicketSession(
        {
          ticket: context.request.headers[SESSION_TICKET_HEADER],
          remoteAddress: context.remoteAddress ?? undefined,
        },
        {
          tickets,
          localOnly: settings.localOnly,
          establish: isSessionFlowView(flow)
            ? async (identifier) =>
                toTicketSessionUser(
                  await flow.establishSessionFor(
                    context,
                    identifier,
                    settings.factor,
                  ),
                  identifier,
                )
            : null,
          sessionRef: () => {
            const id = context.session?.id;
            return typeof id === "string" && isSessionServiceView(sessions)
              ? sessions.sessionRef(id)
              : null;
          },
        },
      );
      return controller.renderJson(verdict, verdict.status);
    },
    async close(sessions: unknown, ref: string): Promise<boolean> {
      return isSessionServiceView(sessions)
        ? sessions.destroyByRef(ref, settings.factor)
        : false;
    },
  };
}
