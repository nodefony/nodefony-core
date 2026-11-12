import { nodefonyError as NodefonyError, clc } from "nodefony";
import { ContextType } from "../../service/http-kernel";
import { HttpRsponseType } from "../context/http/HttpContext";

type JsonDescriptor = {
  configurable?: boolean;
  enumerable?: boolean;
  value?: (this: Error) => unknown;
  writable?: boolean;
};

/** Références vivantes (circulaires) jamais sérialisées, quel que soit l'environnement. */
const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "context",
  "resolver",
  "container",
  "secure",
  "request",
  "response",
]);

/**
 * Sérialise les propriétés propres d'une erreur HTTP, sans jamais LIRE celles
 * qu'on écarte.
 *
 * Ne pas lire compte : `stack` est un accesseur paresseux de V8, et sa première
 * lecture FORMATE la pile (`prepareStackTrace`, plusieurs µs). Lire puis
 * supprimer, c'est payer ce formatage pour le jeter — ce que faisait le rendu
 * d'erreur en production, sur chaque 404.
 *
 * @param error - l'erreur à sérialiser (en pratique un `HttpError`).
 * @param omit - clés à écarter EN PLUS des références vivantes, ou `null`.
 * @returns un objet plat, prêt pour `JSON.stringify`.
 */
export function serializeHttpError(
  error: Error,
  omit: ReadonlySet<string> | null = null,
): Record<string, unknown> {
  const alt: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (EXCLUDED_KEYS.has(key) || omit?.has(key)) continue;
    alt[key] = Reflect.get(error, key);
  }
  return alt;
}

const jsonHttpError: JsonDescriptor = {
  configurable: true,
  writable: true,
  value(this: Error) {
    return serializeHttpError(this);
  },
};

class HttpError extends NodefonyError {
  url?: string | undefined;
  controller?: string | undefined;
  action?: string | undefined;
  jsonResponse?: string | undefined;
  constructor(
    // `unknown` et non une union : l'union `… | any` acceptait déjà TOUT en
    // silence. Les appelants passent aussi des objets (charge JSON d'une
    // réponse d'erreur), que le parent ramène à son message.
    message?: unknown,
    code?: number,
    context?: ContextType,
  ) {
    super(message as string | Error, code);
    // Le contexte est LU ici, jamais gardé : une erreur survit souvent à sa
    // requête (abonné du canal `nodefony.http.request` qui garde le message,
    // journal différé, cause d'une autre erreur) et retenait sinon le contexte
    // entier, sa réponse et sa requête. `context.response` est nul après
    // `clean()`, et le contexte est optionnel : lu une fois, avec son absence.
    const res = context?.response as HttpRsponseType | null | undefined;
    this.url = context?.url;
    if (res && code) {
      res.statusCode = code;
    }
    if (!this.message && res) {
      this.message =
        res.body?.toString() || res.statusMessage || res.getStatusMessage();
    }
    const resolver = context?.resolver;
    this.controller = resolver?.controller?.name ?? undefined;
    this.action = resolver?.actionName ?? undefined;
    if (res) {
      this.jsonResponse = `${res.statusCode} ${res.statusMessage}`.trim();
    }
  }

  /**
   * Construit un VERDICT de protocole (404, 405, 426…) sans capturer de pile.
   *
   * La pile d'un verdict pointe toujours au même endroit du noyau ou du routeur
   * et ne dit rien de la requête ; la capturer coûte ~3,6 µs à profondeur
   * réelle (`micro-error-path.mjs`), payés par chaque requête d'un scanner.
   * Réservé à ce que le framework DÉCIDE — une panne garde sa pile. `stack` ne
   * porte que l'en-tête (`HttpError: Not Found`).
   *
   * @param message - message du verdict.
   * @param code - statut HTTP (ou code de fermeture WebSocket).
   * @param context - contexte de la requête, comme pour le constructeur.
   * @returns l'erreur, sans pile.
   */
  static withoutStack(
    message: string,
    code: number,
    context?: ContextType,
  ): HttpError {
    // Synchrone sur l'unique fil : la limite est rétablie avant que quoi que
    // ce soit d'autre ne construise une erreur.
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    try {
      return new HttpError(message, code, context);
    } finally {
      Error.stackTraceLimit = limit;
    }
  }

  override toString(): string {
    if (this.url !== undefined) {
      return `${clc.red(this.message)}
    ${clc.blue("Name :")} ${this.name}
    ${clc.blue("Type :")} ${this.errorType}
    ${clc.green("Controller :")} ${this.controller}
    ${clc.green("Action :")} ${this.action}
    ${clc.blue("Url :")} ${this.url}
      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.red("Response :")} ${this.jsonResponse}
    ${clc.green("Stack :")} ${this.stack}`;
    }
    return `${clc.red(this.message)}
    ${clc.blue("Name :")} ${this.name}
    ${clc.blue("Type :")} ${this.errorType}

      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.red("Response :")} ${this.jsonResponse}
    ${clc.green("Stack :")} ${this.stack}`;
  }
}
Object.defineProperty(HttpError.prototype, "toJSON", jsonHttpError);

export default HttpError;
