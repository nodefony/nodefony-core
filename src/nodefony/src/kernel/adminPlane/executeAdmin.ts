import nodefonyError from "../../Error";
import type {
  IAdminEndpoint,
  IAdminRequest,
  IAdminResponse,
} from "../../types/IAdminApi";
import { isAdminGranted } from "./adminRbac";

/**
 * Issue d'un endpoint d'administration, sous la forme que TOUTES les portes
 * reçoivent — succès comme échec.
 *
 * C'est volontairement la forme d'une réponse HTTP sans en être une : les
 * producteurs raisonnent déjà en `{status, body}` (un 404 qui joint le plan de
 * la page, un 400 qui nomme les valeurs valides), et chaque porte décide
 * ensuite de l'emballage — JSON pour HTTP, `RpcError` pour le
 * pont WS-RPC, texte pour la CLI et le serveur MCP.
 */
export interface IAdminExecution {
  /** Statut résolu du handler (200 par défaut). */
  status: number;
  /** En-têtes que le producteur a joints, s'il en a joint. */
  headers?: IAdminResponse["headers"];
  /** La donnée, ou le corps d'erreur **que le producteur a préparé**. */
  body: unknown;
}

/**
 * Verdict d'une porte posée AVANT le handler — aujourd'hui l'idempotence des
 * mutations, demain ce que le transport exigera.
 *
 * Soit la porte tranche seule (`shortCircuit` : rejeu mémorisé, 409 concurrent,
 * 400 clé requise), soit elle laisse passer en demandant à être rappelée à
 * l'issue (`onSuccess` mémorise, `onFailure` libère).
 */
export interface IAdminGateVerdict {
  /** Réponse immédiate : le handler n'est pas appelé. */
  shortCircuit?: IAdminExecution;
  /** Appelé après un handler qui a rendu sa réponse. */
  onSuccess?: (execution: IAdminExecution) => void | Promise<void>;
  /** Appelé après un handler qui a levé — l'appel reste réessayable. */
  onFailure?: () => void | Promise<void>;
}

/**
 * Porte optionnelle évaluée entre le RBAC et le handler.
 *
 * Le paramètre qui la porte est **obligatoire et nullable** dans
 * {@link IAdminExecuteInput} : `null` est un choix qu'on lit dans le code
 * d'appel (« cette porte ne lit que des GET »), là où un paramètre absent
 * serait un oubli qu'aucune relecture ne rattrape.
 */
export type AdminGate = (
  request: IAdminRequest,
) => IAdminGateVerdict | Promise<IAdminGateVerdict>;

/** Ce dont l'exécution a besoin — aucun transport, aucun conteneur. */
export interface IAdminExecuteInput {
  /** L'endpoint résolu par l'appelant (par nom de route, ou par chemin). */
  endpoint: IAdminEndpoint;
  /** La requête projetée : params, query, corps, identité, rôles. */
  request: IAdminRequest;
  /**
   * Rôle exigé, déjà résolu par
   * {@link resolveAdminRole} — passé plutôt que recalculé pour que
   * la porte HTTP puisse honorer le rôle **monté** avec sa route.
   */
  requiredRole: string;
  /** Porte d'idempotence, ou `null` quand l'appelant n'en pose aucune. */
  gate: AdminGate | null;
  /**
   * Notification d'une panne serveur (le handler a levé autre chose qu'une
   * erreur cliente). Le cœur ne journalise pas à la place de l'appelant : la
   * route HTTP veut un `ERROR` dans le syslog, la CLI veut une trace à l'écran,
   * un harnais de test veut relever l'exception telle quelle.
   */
  onServerError?: (error: Error) => void;
}

/**
 * Normalise ce qu'un handler a rendu : donnée brute, ou enveloppe.
 *
 * Discrimination volontairement étroite — enveloppe **si et seulement si**
 * `body` est présent AVEC `status` ou `headers`. Un objet métier qui posséderait
 * un champ `body` (une réponse de webhook, un message stocké) n'en est pas une.
 *
 * @param result - le retour du handler, tel quel.
 * @returns l'issue normalisée, statut 200 par défaut.
 */
export function normalizeAdminResult(result: unknown): IAdminExecution {
  if (
    result !== null &&
    typeof result === "object" &&
    "body" in result &&
    ("status" in result || "headers" in result)
  ) {
    const envelope = result as IAdminResponse;
    return {
      status: envelope.status ?? 200,
      headers: envelope.headers,
      body: envelope.body,
    };
  }
  return { status: 200, body: result };
}

/**
 * Exécute un endpoint du plan d'administration — **la porte unique**, sans HTTP.
 *
 * ⭐ **Une source, plusieurs portes.** Le data plane est un ensemble de
 * fonctions `IAdminRequest → donnée` ; ce qui les entoure (autorisation,
 * idempotence des mutations, normalisation du retour, traduction des erreurs)
 * est une règle unique, et elle vit ici. La route HTTP montée par le broker, le
 * pont WS-RPC, la commande `inspect` et le serveur MCP appellent tous cette
 * fonction : ils ne se distinguent que par la façon de RÉSOUDRE l'endpoint (par
 * nom de route côté framework, par couple namespace/chemin côté cœur) et par
 * l'emballage de l'issue.
 *
 * Ce que la duplication précédente coûtait, concrètement : le producteur de
 * `module/{name}/docs/{slug}` joint au refus d'une section inconnue le plan de
 * la page (les titres réels). La seconde implémentation ne gardait que le
 * statut — un agent lisait « introuvable » et concluait que la PAGE n'existait
 * pas, alors que seul le nom de section était faux.
 *
 * @param input - endpoint, requête, rôle exigé, porte éventuelle.
 * @returns l'issue, succès comme échec, **corps du producteur préservé**.
 */
export async function executeAdminEndpoint(
  input: IAdminExecuteInput,
): Promise<IAdminExecution> {
  const { endpoint, request, requiredRole, gate, onServerError } = input;

  // ── RBAC (fail-closed) ─────────────────────────────────────────────────────
  // L'authentification est garantie en amont par la porte (firewall pour HTTP,
  // vérificateur de jeton pour le MCP) ; ici on tranche le RÔLE. Un appelant
  // authentifié SANS le rôle requis — `roles: []` compris — est rejeté.
  if (!isAdminGranted(request.roles, requiredRole)) {
    return {
      status: 403,
      body: { error: "Forbidden", required: requiredRole },
    };
  }

  const verdict = gate ? await gate(request) : null;
  if (verdict?.shortCircuit) return verdict.shortCircuit;

  try {
    const execution = normalizeAdminResult(await endpoint.handler(request));
    await verdict?.onSuccess?.(execution);
    return execution;
  } catch (error) {
    await verdict?.onFailure?.();
    // Une erreur 4xx portée par un `nodefonyError` applicatif (ex.
    // PaginationModeError → 400 : mode de pagination que le store ne sait pas
    // honorer) est une faute du CLIENT, pas une panne. On la restitue telle
    // quelle, sans la maquiller en 500 ni la faire journaliser.
    if (
      error instanceof nodefonyError &&
      typeof error.code === "number" &&
      error.code >= 400 &&
      error.code < 500
    ) {
      return { status: error.code, body: { error: error.message } };
    }
    onServerError?.(error as Error);
    return { status: 500, body: { error: "Internal admin handler error" } };
  }
}
