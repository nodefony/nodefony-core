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
 * Statut d'un conflit d'ÉTAT : la requête est valide, c'est l'état courant du
 * serveur qui la refuse (RFC 9110 §15.5.10). Réécrire une valeur déclarée unique
 * est exactement ce cas — ni 400 (le corps est lisible), ni 422 (le contenu
 * respecte le schéma), ni 500 (rien n'est cassé).
 */
const CONFLICT_STATUS = 409;

/**
 * Codes rendus par les pilotes de base de données quand une écriture viole une
 * contrainte d'UNICITÉ — le seul signal fiable, commun à tous les moteurs.
 *
 * Volontairement restreint aux codes qui ne désignent QUE l'unicité : le
 * `SQLITE_CONSTRAINT` générique couvre aussi NOT NULL, CHECK et les clés
 * étrangères, et le retenir rendrait un 409 là où la vérité est un 422 (ou un
 * 500). Un code inconnu retombe donc sur le comportement d'avant — l'oubli coûte
 * un statut trop pessimiste, jamais un mensonge.
 */
const UNIQUE_VIOLATION_CODES = new Set<string>([
  "SQLITE_CONSTRAINT_UNIQUE", // better-sqlite3 — code étendu
  "SQLITE_CONSTRAINT_PRIMARYKEY",
  "23505", // PostgreSQL — unique_violation
  "ER_DUP_ENTRY", // MySQL / MariaDB
  "1062", // MySQL — errno de ER_DUP_ENTRY
  "11000", // MongoDB — E11000 duplicate key
  "11001", // MongoDB — duplicate key on update
]);

/**
 * Ce qu'un client reçoit sur un doublon.
 *
 * Le message du pilote (« UNIQUE constraint failed: posts.slug ») nomme la table
 * ET la colonne : c'est de la cartographie de schéma offerte à qui frappe la
 * porte. Le détail reste dans la `stack` — journal côté serveur, et corps de
 * réponse hors production.
 */
const UNIQUE_VIOLATION_MESSAGE =
  "Conflict — a resource with these unique values already exists";

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
 * Vrai si l'erreur — ou l'une de ses causes — est une violation de contrainte
 * d'unicité remontée par un pilote de base de données.
 *
 * **La descente dans `cause` n'est pas un raffinement, c'est la condition pour
 * que ça marche** : Drizzle enveloppe toute erreur de pilote dans un
 * `DrizzleQueryError` dont le `code` vaut `undefined`. Sans elle, une écriture
 * en doublon reste un 500.
 *
 * Reconnaissance par CODE seul, jamais par message : « duplicate key » dans un
 * texte d'erreur est un indice, pas une preuve, et un faux positif déguiserait
 * une panne réelle en conflit — le client réessaierait autrement au lieu
 * d'alerter. Même parti-pris de duck-typing que `toValidationFields`, pour la
 * même raison (l'application peut embarquer sa propre copie du pilote).
 *
 * Ne coûte rien au chemin nominal : ne tourne que sur une erreur déjà levée.
 *
 * @param error - erreur remontée par le pipeline.
 * @returns vrai si un code de violation d'unicité est trouvé dans la chaîne.
 */
function isUniqueViolation(error: Error): boolean {
  let current: unknown = error;
  // Chaîne bornée : un pilote enveloppe une fois (Drizzle), deux au pire. La
  // borne protège aussi d'un `cause` cyclique, qui bouclerait sur un chemin
  // d'erreur — l'endroit exact où l'on ne veut pas d'une seconde panne.
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & { code?: unknown; errno?: unknown };
    if (
      (candidate.code !== undefined &&
        UNIQUE_VIOLATION_CODES.has(String(candidate.code))) ||
      (candidate.errno !== undefined &&
        UNIQUE_VIOLATION_CODES.has(String(candidate.errno)))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
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
    // Le code n'est retenu que s'il est numérique (même raison qu'en HTTP : un
    // code de pilote est une chaîne). On ne passe PAS par `normalizeHttpStatus`
    // ici : en phase connectée le code est déjà un code de fermeture WS
    // (1000-4999), qu'elle écraserait en 500.
    const rawCode = (httpError as { code?: unknown }).code;
    let code =
      typeof rawCode === "number" && Number.isInteger(rawCode) ? rawCode : 500;
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
    if (isUniqueViolation(error)) {
      // Message string, JAMAIS l'erreur d'origine : `nodefonyError.parseMessage`
      // recopie le `code` de l'erreur qu'on lui passe — lui donner l'erreur du
      // pilote écraserait le 409 par « 23505 ».
      const conflict = new nodefonyError(
        UNIQUE_VIOLATION_MESSAGE,
        CONFLICT_STATUS,
      );
      conflict.stack = error.stack;
      return new HttpError(
        conflict,
        CONFLICT_STATUS,
        context as unknown as undefined,
      );
    }
    // Le `code` n'est passé que s'il est numérique : `HttpError` pose
    // `response.statusCode = code` DÈS son constructeur, donc un code textuel de
    // pilote atteindrait la réponse avant même le rendu.
    const code = (error as { code?: unknown }).code;
    return new HttpError(
      error,
      typeof code === "number" ? code : undefined,
      context as unknown as undefined,
    );
  }

  /**
   * Ramène un `code` d'erreur à un statut HTTP réellement émettable.
   *
   * Le filtre de type n'est pas défensif « au cas où » : `nodefonyError.parseMessage`
   * RECOPIE le code de l'erreur source, et pilotes comme Node en produisent des
   * textuels (`"ENOENT"`, `"ECONNRESET"`, `"23505"`). Sans lui, la chaîne partait
   * telle quelle en statut de réponse et le serveur répondait hors RFC 9110 §15.
   */
  private normalizeHttpStatus(code: unknown): number {
    if (typeof code !== "number" || !Number.isInteger(code)) return 500;
    if (code === 200) return 500; // legacy quirk preserved
    if (code < 100 || code > 599) return 500;
    return code;
  }
}

export default DefaultErrorRenderer;
