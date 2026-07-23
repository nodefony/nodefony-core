/// <reference types="node" />
import type {
  IErrorRenderer,
  IErrorHttpResult,
  IErrorWebsocketResult,
} from "../interfaces/IErrorRenderer";
import type { IHttpContext, IWebsocketContext } from "../interfaces/IContext";
import HttpError from "../src/errors/httpError";
import { toWsCloseCode } from "../src/context/websocket/WebsocketContext";
import { Nodefony, nodefonyError } from "nodefony";

/** Une donnée rejetée par la validation n'est pas une requête malformée : 422, pas 400. */
const VALIDATION_STATUS = 422;

/**
 * Ce qu'un client reçoit à la place du détail d'une panne serveur, en production.
 *
 * Le message d'une exception non maîtrisée cite volontiers un chemin de fichier,
 * un nom de table, une requête SQL ou un identifiant interne. Le rendre à un
 * client — a fortiori **anonyme**, un close WS partant avant le firewall —
 * revient à publier de la reconnaissance gratuite.
 */
const OPAQUE_SERVER_ERROR = "Internal Server Error";

/**
 * Clés d'un `HttpError` sérialisé qui décrivent les ENTRAILLES du serveur et ne
 * doivent jamais franchir la frontière en production.
 */
const INTERNAL_ERROR_KEYS = [
  "stack",
  "controller",
  "action",
  "bundle",
  "url",
  "pdu",
] as const;

/**
 * Vrai si le runtime tourne en production — le détail des erreurs reste alors au
 * journal, seul le serveur le voit.
 *
 * ⚠️ La comparaison porte sur `"production"` **en toutes lettres** : `Kernel.setEnv`
 * réduit toujours l'environnement à `"development" | "production"`
 * (`Kernel.resolveRuntimeEnv`). Une garde écrite `=== "prod"` ne se déclenche donc
 * JAMAIS, même si `"prod"` est une valeur acceptée en entrée.
 *
 * Résolu à chaque rendu (pas de cache) : une erreur est déjà un chemin froid, et
 * mémoïser rendrait le masquage insensible à un changement d'environnement entre
 * deux tests — un gate qu'on ne peut plus voir mordre.
 */
const isProduction = (): boolean =>
  Nodefony.getKernel()?.environment === "production";

/** Une anomalie de champ, telle qu'elle sort d'un schéma Zod. */
interface IValidationIssue {
  /** Chemin du champ fautif (`["author", "email"]`). */
  path?: unknown[];
  /** Message lisible. */
  message?: string;
  /** Code du contrôle qui a échoué (`too_small`, `invalid_type`…). */
  code?: string;
}

/** Champ fautif, tel qu'exposé au client dans le corps JSON (`error.fields`). */
interface IValidationField {
  /** Chemin pointé du champ (`"author.email"`). */
  field: string;
  /** Message lisible. */
  message: string;
  /** Contrôle qui a échoué (`too_small`…) — utile au client pour réagir finement. */
  rule?: string;
}

/**
 * Reconnaît une erreur de validation Zod et en extrait les champs fautifs.
 *
 * Reconnaissance **structurelle** (`name` + `issues`), pas `instanceof ZodError` :
 * une application peut embarquer sa propre copie de zod (résolutions npm multiples),
 * et `instanceof` échouerait alors en silence — la validation retomberait en 500.
 * Même parti-pris que le duck-typing de `isPromise` dans le framework.
 *
 * Ne coûte rien au chemin nominal : ce code ne tourne que sur une erreur déjà levée.
 *
 * @param error - erreur remontée par le pipeline.
 * @returns les champs fautifs, ou `null` si ce n'est pas une erreur de validation.
 */
function toValidationFields(error: Error): IValidationField[] | null {
  const candidate = error as Error & { issues?: unknown };
  if (error.name !== "ZodError" || !Array.isArray(candidate.issues)) {
    return null;
  }
  return (candidate.issues as IValidationIssue[]).map((issue) => ({
    field: Array.isArray(issue.path) ? issue.path.join(".") : "",
    message: issue.message ?? "invalide",
    rule: issue.code,
  }));
}

/**
 * Construit l'erreur **422** exposée au client à partir des champs fautifs.
 *
 * Pourquoi 422 et pas 400 : la requête est syntaxiquement correcte (le corps a été
 * parsé) — c'est son **contenu** qui viole le contrat (RFC 9110 §15.5.21). Un 400
 * dirait « corps illisible » et enverrait le client chercher au mauvais endroit.
 *
 * Le message d'origine de zod (un JSON d'anomalies) est remplacé par un résumé
 * lisible ; la **stack d'origine est conservée** (débogage), et `fields` est porté par
 * l'erreur elle-même : `toJSON()` sérialise les propriétés propres, donc le client
 * reçoit `error.fields` et sait QUEL champ corriger — pas seulement que « ça a échoué ».
 */
function toValidationError(
  error: Error,
  fields: IValidationField[],
): nodefonyError {
  const summary = fields
    .map((f) => (f.field ? `${f.field}: ${f.message}` : f.message))
    .join(" · ");
  const validation = new nodefonyError(
    `Validation failed — ${summary}`,
    VALIDATION_STATUS,
  );
  validation.stack = error.stack;
  (validation as nodefonyError & { fields: IValidationField[] }).fields =
    fields;
  return validation;
}

/**
 * Default Nodefony error renderer — preserves the legacy JSON error shape.
 *
 * HTTP body (unchanged across the migration):
 *   {
 *     code:    <http status>,
 *     message: <error message>,
 *     error:   <HttpError.toJSON() — stack, controller, action, jsonResponse...>,
 *     nodefony: { requestId, scheme, name, version, environment, debug, ... },
 *     result:  null,
 *   }
 *
 * WS close frame:
 *   code:   clamped to WS range (1000-4999), 1011 if HTTP-style code, 500→1011
 *   reason: error.message
 *
 * Stateless singleton — zero per-request allocation. Override via
 * `httpKernel.setErrorRenderer(custom)` for prod hardening or RFC 7807.
 */
class DefaultErrorRenderer implements IErrorRenderer {
  renderHttp(error: Error, context: IHttpContext): IErrorHttpResult {
    const httpError = this.toHttpError(error, context);
    const status = this.normalizeHttpStatus(
      httpError.code as number | undefined,
    );
    httpError.code = status;

    // Mutate context.metaData like the legacy onError did — the test contract
    // expects nodefony.* fields to be present alongside error/code/message.
    const obj = (context as unknown as { metaData: Record<string, unknown> })
      .metaData;
    const serialized = (httpError as nodefonyError).toJSON() as Record<
      string,
      unknown
    >;
    // PRODUCTION — le client reçoit un verdict, pas un rapport d'autopsie :
    // la stack et le nommage interne (controller/action/module/url) sortent du
    // corps, et le message d'une panne 5xx devient opaque. Les 4xx gardent le
    // leur : un 422 de validation ou un 403 de policy est un message ÉCRIT POUR
    // le client, pas une fuite. Le détail réel part au journal (`logRequest`).
    const message =
      isProduction() && status >= 500 ? OPAQUE_SERVER_ERROR : httpError.message;
    if (isProduction()) {
      for (const key of INTERNAL_ERROR_KEYS) delete serialized[key];
      serialized.message = message;
    }
    obj.error = serialized as unknown as Error;
    obj.code = status;
    obj.message = message;

    return {
      status,
      message,
      body: obj,
    };
  }

  renderWebsocket(
    error: Error,
    context: IWebsocketContext,
  ): IErrorWebsocketResult {
    const httpError = this.toHttpError(error, context);
    // Reject phase (no WS connection yet): caller uses HTTP-style status.
    // Connected phase: caller uses WS close code. Both clamped here.
    let code = (httpError.code as number) ?? 500;
    if (
      context &&
      (context as unknown as { rejected?: boolean }).rejected === false
    ) {
      // Déjà connecté → DOIT être un code de fermeture WS valide. `toWsCloseCode`
      // (RFC 6455 §7.4, source unique) mappe correctement les codes HTTP : 401/403
      // → 1008 (Policy Violation, le client NE reconnecte PAS), 5xx → 1011, 404/
      // autre 4xx → 4004. Le clamp brut `< 1000 → 1011` écrasait 401 en 1011
      // (Internal Error) → le RealtimeClient reconnectait en boucle au lieu
      // d'abandonner (un refus d'auth au handshake = policy, pas erreur serveur).
      code = toWsCloseCode(code);
    } else {
      // Reject phase still uses HTTP-style; clamp to 4xx/5xx.
      if (code > 599) code = 500;
    }
    // PRODUCTION — même règle qu'en HTTP, avec une raison de plus de la tenir :
    // en WS le controller est instancié AU HANDSHAKE, donc **avant le firewall**.
    // Une exception qui remonte de son `initialize()` ferme la socket d'un
    // ANONYME ; y coller le message brut publie l'interne à qui frappe la porte.
    // `code` a déjà été mappé : 1011 (et 5xx en phase de rejet) = panne serveur.
    const internal = code === 1011 || (code >= 500 && code <= 599);
    const reason =
      isProduction() && internal ? OPAQUE_SERVER_ERROR : httpError.message;
    return { code, reason };
  }

  private toHttpError(
    error: Error,
    context: IHttpContext | IWebsocketContext,
  ): HttpError {
    if (error instanceof HttpError) return error;
    const fields = toValidationFields(error);
    if (fields) {
      const httpError = new HttpError(
        toValidationError(error, fields),
        VALIDATION_STATUS,
        context as unknown as undefined,
      );
      // Porté par le HttpError LUI-MÊME : c'est lui que `renderHttp` sérialise
      // (`toJSON()` des propriétés propres) — l'erreur enveloppée n'est pas parcourue.
      (httpError as HttpError & { fields: IValidationField[] }).fields = fields;
      return httpError;
    }
    const code = (error as { code?: number }).code;
    return new HttpError(
      error,
      code as number,
      context as unknown as undefined,
    );
  }

  private normalizeHttpStatus(code: number | undefined): number {
    if (code === 200) return 500; // legacy quirk preserved
    if (!code) return 500;
    return code;
  }
}

export default DefaultErrorRenderer;
