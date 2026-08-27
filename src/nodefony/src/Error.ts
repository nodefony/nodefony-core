/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import { Nodefony } from "./Nodefony";
import { typeOf } from "./Tools";

import { STATUS_CODES } from "node:http";
import { inspect } from "node:util";
import clc from "./colors";

declare global {
  interface Error {
    // errno is number in ErrnoException — keep compatible
    errno?: string | number;
    bytesParsed?: number;
    // any : forme libre selon la source de l'erreur (ORM, natif)
    errors?: any;
    parent?: Error;
    actual?: any;
    expected?: any;
    operator?: any;
    syscall?: any;
    address?: any;
    port?: any;
    rawPacket?: any;
    fields?: any;
    code?: any;
    index?: any;
    value?: any;
    table?: any;
    constraint?: any;
  }
}

type JsonDescriptor = {
  configurable?: boolean;
  enumerable?: boolean;
  value?: () => any;
  writable?: boolean;
};

const json: JsonDescriptor = {
  configurable: true,
  writable: true,
  value() {
    const alt: Record<string, any> = {};
    const storeKey = function (this: Record<string, any>, key: string) {
      alt[key] = this[key];
    };
    Object.getOwnPropertyNames(this).forEach(storeKey, this);
    return alt;
  },
};

// oxlint-disable-next-line no-extend-native -- extension DÉLIBÉRÉE : toute erreur, y compris celles levées par Node ou une dépendance, doit être sérialisable par le syslog ; non-énumérable, donc invisible d'un `for...in`
Object.defineProperty(Error.prototype, "toJSON", json);

const exclude = {
  context: true,
  resolver: true,
  container: true,
  secure: true,
};
const jsonNodefony: JsonDescriptor = {
  configurable: true,
  writable: true,
  value() {
    const alt: Record<string, any> = {};
    const storeKey = function (this: Record<string, any>, key: string) {
      if (key in exclude) {
        return;
      }
      alt[key] = this[key];
    };
    Object.getOwnPropertyNames(this).forEach(storeKey, this);
    return alt;
  },
};

/**
 * Adapter d'erreurs d'une bibliothèque tierce (driver ORM, client externe…).
 *
 * Permet au core de **reconnaître** (`isError`) et **formater** (`errorToString`)
 * une famille d'erreurs sans dépendre de la bibliothèque : le module tiers fournit
 * l'implémentation et s'enregistre via {@link registerErrorAdapter}. Le core reste
 * agnostique — il ne nomme aucun driver.
 */
export interface IErrorAdapter {
  /** Vrai si l'erreur relève de la famille gérée par cet adapter. */
  isError(e: Error): boolean;
  /** Formate l'erreur en message lisible. */
  errorToString(e: unknown): string;
}

// Registre lazy des adapters d'erreurs tiers (clé = nom du module, ex. "mongoose").
// `null` tant qu'aucun adapter n'est enregistré → zéro allocation au boot (le core
// n'alloue pas « au cas où »). Itéré uniquement quand une `Error` est classifiée.
let _errorAdapters: Map<string, IErrorAdapter> | null = null;

/**
 * Enregistre un adapter d'erreurs tiers sous une clé (ex. le nom du driver ORM
 * `"mongoose"`). Inversion de dépendance : le module s'enregistre lui-même à son
 * boot, le core ne connaît aucune bibliothèque. `null` retire l'adapter (teardown,
 * tests).
 *
 * @param name - clé unique de l'adapter (nom du module/driver).
 * @param adapter - implémentation `{ isError, errorToString }`, ou `null` pour retirer.
 */
export function registerErrorAdapter(
  name: string,
  adapter: IErrorAdapter | null,
): void {
  if (adapter === null) {
    _errorAdapters?.delete(name);
    return;
  }
  if (_errorAdapters === null) {
    _errorAdapters = new Map();
  }
  _errorAdapters.set(name, adapter);
}

/**
 * Premier adapter dont relève l'erreur, ou `null`. Gratuit tant qu'aucun adapter
 * n'est enregistré (registre `null`). Un adapter qui throw est ignoré — il ne doit
 * jamais casser la classification d'une erreur.
 */
const findErrorAdapter = function (error: Error): IErrorAdapter | null {
  if (_errorAdapters === null) {
    return null;
  }
  for (const adapter of _errorAdapters.values()) {
    try {
      if (adapter.isError(error)) {
        return adapter;
      }
    } catch {
      /* un adapter défaillant ne doit pas casser la détection */
    }
  }
  return null;
};

/**
 * Erreur Nodefony — wrapper riche autour de `Error` natif qui ajoute :
 * - Un `code` numérique (HTTP status ou code custom — pas un string).
 * - Un `errorType` détecté automatiquement (TypeError, SystemError,
 *   AssertionError, OrmError, ClientError, etc.).
 * - Une sérialisation `toJSON()` filtrée qui exclut `context`, `resolver`,
 *   `container`, `secure` (références circulaires).
 * - Un `toString()` coloré (cli-color) qui adapte le format selon
 *   l'environnement (production = message court ; dev = champs détaillés).
 *
 * @example Wrap d'une erreur existante
 * ```ts
 * try { ... } catch (e) { throw new nodefonyError(e, 500); }
 * ```
 *
 * @example Erreur custom
 * ```ts
 * throw new nodefonyError("user not found", 404);
 * ```
 *
 * @remarks Les erreurs de bibliothèques tierces (drivers ORM…) sont reconnues
 *   et formatées via un adapter injecté par `registerErrorAdapter` — le core
 *   reste découplé des modules. Sans adapter enregistré, l'erreur retombe sur la
 *   classification générique.
 */
class nodefonyError extends Error {
  public override code: number | null;
  public error?: Error;
  public errorType: string;
  /** Adapter d'erreur tiers résolu (erreur ORM…) quand `errorType === "OrmError"`. */
  #errorAdapter: IErrorAdapter | null = null;
  //public actual : string
  [key: string]: any;

  /**
   * Sérialisation JSON filtrée — POSÉE sur le prototype plus bas
   * (`Object.defineProperty(nodefonyError.prototype, "toJSON", …)`), donc
   * déclarée ici sans initialiseur (`declare` : aucun code émis).
   *
   * Sur `Error`, la même méthode est déclarée **optionnelle** : elle
   * n'appartient pas au type standard, et l'imposer rendrait incompilable toute
   * classe tierce qui écrit `implements Error` (cf `types/globals.ts`). Sur
   * `nodefonyError`, elle est CERTAINE — c'est la classe qui la garantit.
   */
  declare toJSON: () => Record<string, any>;

  /**
   * @param message - string ou `Error` natif à wrapper. Si Error, ses champs
   *   (message, code, stack) sont copiés ; le type est détecté.
   * @param code - statut HTTP ou code custom (utilisé par HttpError pour le
   *   status code de la réponse).
   */
  constructor(message?: string | Error, code?: number) {
    if (message instanceof Error) {
      super(message.message);
    } else {
      super(message);
    }
    this.name = this.constructor.name;
    this.code = null;
    this.errorType = this.name;
    if (code) {
      this.code = code;
    }
    if (message) {
      this.parseMessage(message);
    }
  }

  /**
   * Type guard — vérifie qu'une valeur est une instance d'`Error`.
   *
   * Override de la méthode native ajoutée par TS 6 ; conserve la signature
   * pour rester compatible avec les consommateurs qui utilisent `Error.isError`.
   *
   * @param error - valeur inconnue à tester.
   * @returns `true` si `error instanceof Error`.
   */
  static override isError(error: unknown): error is Error {
    return error instanceof Error;
  }

  /**
   * Détecte la catégorie d'une erreur (TypeError, SystemError, OrmError, etc.).
   *
   * Utilisée par `getType()` pour peupler `errorType` et copier les champs
   * spécifiques au type (errno, syscall, bytesParsed, etc.).
   *
   * @param error - instance d'`Error` à classifier.
   * @returns nom de la catégorie ou `false` si pas une `Error`.
   */
  static detectType(error: Error): string | false {
    switch (true) {
      case error instanceof ReferenceError:
        return "ReferenceError";
      case error instanceof TypeError:
        return "TypeError";
      case error instanceof SyntaxError:
        return "SyntaxError";
      case error instanceof assert.AssertionError:
        return "AssertionError";
      case findErrorAdapter(error) !== null:
        return "OrmError";
      case error instanceof Error:
        if (error.errno) {
          return "SystemError";
        }
        if (error.bytesParsed) {
          return "ClientError";
        }
        try {
          return error.constructor.name || "Error";
        } catch (e) {
          return "Error";
        }
    }
    return false;
  }

  /**
   * Détecte le type d'erreur et copie ses champs spécifiques sur `this`.
   *
   * Côté SystemError → `errno/syscall/address/port` ; AssertionError →
   * `actual/expected/operator` ; ClientError → `bytesParsed/rawPacket`, etc.
   *
   * @param error - erreur source à analyser.
   * @returns nom de la catégorie (jamais `false` — fallback `error.constructor.name` ou `"Error"`).
   */
  getType(error: Error): string {
    const errorType = nodefonyError.detectType(error);
    if (errorType) {
      switch (errorType) {
        case "TypeError":
        case "ReferenceError":
        case "SyntaxError":
          return errorType;
        case "AssertionError":
          this.actual = error.actual;
          this.expected = error.expected;
          this.operator = error.operator;
          return errorType;
        case "SystemError":
          this.errno = error.errno;
          this.syscall = error.syscall;
          this.address = error.address;
          this.port = error.port;
          this.stack = error.stack;
          return errorType;
        case "ClientError":
          this.bytesParsed = error.bytesParsed;
          this.rawPacket = error.rawPacket;
          return errorType;
        case "OrmError":
          // Mémorise l'adapter résolu (sur l'erreur native originale) pour que
          // `toString()` délègue son rendu sans re-détecter sur le wrapper.
          this.#errorAdapter = findErrorAdapter(error);
          return errorType;
        default:
          return error.constructor.name;
      }
    }
    if (error && error.constructor) {
      return error.constructor.name;
    }
    return "Error";
  }

  /**
   * Sérialise l'erreur en string coloré (cli-color) selon `errorType` et l'environnement.
   *
   * En **production**, retourne un message court (type + message) ; sinon, formatage
   * détaillé multi-lignes. Ajoute la stack si `kernel.debug` est actif.
   *
   * ⚠️ La garde compare à `"production"` **en toutes lettres**. Elle a longtemps
   * comparé à `"prod"` — jamais vraie : `Kernel.setEnv()` réduit toujours
   * l'environnement à `"development" | "production"` (`resolveRuntimeEnv`), même
   * quand l'utilisateur a écrit `prod`. Le format court n'était donc jamais rendu.
   *
   * @returns string formatée prête pour `console.log` ou syslog.
   */
  override toString(): string {
    let err = "";
    switch (this.errorType) {
      case "Error":
        if (Nodefony.getKernel()?.environment === "production") {
          return err;
        }
        err = `${clc.blue("Name :")} ${this.name}
        ${clc.blue("Type :")} ${this.errorType}
        ${clc.red("Code :")} ${this.code}
        ${clc.red("Message :")} ${this.message}`;
        break;
      case "SystemError":
        if (Nodefony.getKernel()?.environment === "production") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message,
          )}`;
        }
        err = `${clc.blue("Name :")} ${this.name}
      ${clc.blue("Type :")} ${this.errorType}
      ${clc.red("Message :")} ${this.message}
      ${clc.red("Ernno :")} ${this.errno}
      ${clc.blue("Syscall :")} ${this.syscall}
      ${clc.blue("Address :")} ${this.address}
      ${clc.blue("Port :")} ${this.port}`;
        break;
      case "AssertionError":
        if (Nodefony.getKernel()?.environment === "production") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message,
          )}`;
        }
        err = `${clc.blue("Name :")} ${this.name}
      ${clc.blue("Type :")} ${this.errorType}
      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.white("Actual :")} ${this.actual}
      ${clc.white("Expected :")} ${this.expected}
      ${clc.white("Operator :")} ${this.operator}`;
        break;
      case "ClientError":
        if (Nodefony.getKernel()?.environment === "production") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message,
          )}`;
        }
        err = `${clc.blue("Name :")} ${this.name}
      ${clc.blue("Type :")} ${this.errorType}
      ${clc.red("Code :")} ${this.code}
      ${clc.red("Message :")} ${this.message}
      ${clc.white("BytesParsed :")} ${this.bytesParsed}
      ${clc.white("RawPacket :")} ${this.rawPacket}`;
        break;
      case "OrmError":
        return this.#errorAdapter?.errorToString(this) ?? this.message;
      default:
        if (Nodefony.getKernel()?.environment === "production") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message,
          )}`;
        }
        err = `${clc.blue("Name :")} ${this.name}
        ${clc.blue("Type :")} ${this.errorType}
        ${clc.red("Message :")} ${this.message}`;
        break;
    }
    if (Nodefony.getKernel()?.debug) {
      err += `
        ${clc.green("Stack :")} ${this.stack}`;
    }
    return err;
  }

  /**
   * Parse l'argument du constructeur et hydrate les champs (`message`, `code`, `stack`).
   *
   * Trois cas : `Error` natif (copie message/code/stack), `object` (extrait
   * `status/code/message` + capture stack), autre (fallback `getDefaultMessage`).
   *
   * @param message - string, `Error`, ou objet quelconque à interpréter.
   */
  parseMessage(message: any) {
    this.errorType = this.getType(message);
    switch (typeOf(message)) {
      case "Error":
        this.message = message.message;
        if (message.code) {
          this.code = message.code;
        }
        this.stack = message.stack;
        break;
      case "object":
        // Capturing stack trace, excluding constructor call from it.
        Error.captureStackTrace(message, this.constructor);
        if (message.status) {
          this.code = message.status;
        }
        if (message.code) {
          this.code = message.code;
        }
        try {
          if (message.message) {
            this.message = message.message;
          } else {
            // this.message = JSON.stringify(message);
            this.message = inspect(message, { depth: 0 });
          }
        } catch (e: any) {
          this.error = e;
        }
        break;
      default:
        this.getDefaultMessage();
    }
  }

  /**
   * Renseigne `this.message` à partir du `code` HTTP via `STATUS_CODES`.
   *
   * Fallback quand aucun message n'est fourni mais qu'un code est connu —
   * ex : `new nodefonyError(undefined, 404)` → message `"Not Found"`.
   */
  getDefaultMessage() {
    if (!this.message && this.code) {
      const str = this.code.toString();
      if (str in STATUS_CODES) {
        this.message = STATUS_CODES[str] || "";
      }
    }
  }

  /**
   * Affiche l'erreur formatée sur `console.log` (raccourci de `toString()`).
   *
   * @returns `undefined` — `console.log` ne retourne rien.
   */
  logger() {
    return console.log(this.toString());
  }
}

Object.defineProperty(nodefonyError.prototype, "toJSON", jsonNodefony);

export default nodefonyError;
