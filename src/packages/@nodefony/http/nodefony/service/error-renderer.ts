/// <reference types="node" />
import type {
  IErrorRenderer,
  IErrorHttpResult,
  IErrorWebsocketResult,
} from "../interfaces/IErrorRenderer";
import type { IHttpContext, IWebsocketContext } from "../interfaces/IContext";
import HttpError from "../src/errors/httpError";
import { toWsCloseCode } from "../src/context/websocket/WebsocketContext";
import { nodefonyError } from "nodefony";

/** Une donnée rejetée par la validation n'est pas une requête malformée : 422, pas 400. */
const VALIDATION_STATUS = 422;

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
    obj.error = (httpError as nodefonyError).toJSON() as Error;
    obj.code = status;
    obj.message = httpError.message;

    return {
      status,
      message: httpError.message,
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
    return { code, reason: httpError.message };
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
