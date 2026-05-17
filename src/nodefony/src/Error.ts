/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import { Nodefony } from "./Nodefony";
import { typeOf } from "./Tools";

import { STATUS_CODES } from "node:http";
import { inspect } from "node:util";
import clc from "cli-color";

declare global {
  interface Error {
    // errno is number in ErrnoException — keep compatible
    errno?: string | number;
    bytesParsed?: number;
    // any to avoid conflict with Sequelize BulkRecordError.errors: Error
    errors?: any;
    parent?: Error;
    // sql removed — conflicts with Sequelize DatabaseErrorParent TS2320
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

// TODO(orm-session): remplacer par un registre IErrorAdapter — @nodefony/sequelize et @nodefony/mongoose
// s'enregistrent eux-mêmes, le core ne doit pas connaître les ORMs
let _sequelizeAdapter: {
  isError(e: Error): boolean;
  errorToString(e: unknown): string;
} | null = null;
let _mongooseAdapter: {
  isError(e: Error): boolean;
  errorToString(e: unknown): string;
} | null = null;

/**
 * Enregistre l'adapter Sequelize pour la détection et le formatage des erreurs ORM.
 *
 * Appelé par `@nodefony/sequelize` au boot — le core ne dépend pas de l'ORM.
 *
 * @param adapter - implémentation `{ isError, errorToString }` ou `null` pour désactiver.
 */
export function registerSequelizeAdapter(
  adapter: typeof _sequelizeAdapter,
): void {
  _sequelizeAdapter = adapter;
}

/**
 * Enregistre l'adapter Mongoose pour la détection et le formatage des erreurs ORM.
 *
 * Appelé par `@nodefony/mongoose` au boot — le core ne dépend pas de l'ORM.
 *
 * @param adapter - implémentation `{ isError, errorToString }` ou `null` pour désactiver.
 */
export function registerMongooseAdapter(
  adapter: typeof _mongooseAdapter,
): void {
  _mongooseAdapter = adapter;
}

const isSequelizeError = function (error: Error) {
  try {
    return _sequelizeAdapter?.isError(error) ?? false;
  } catch (e) {
    return false;
  }
};

const isMongooseError = function (error: Error) {
  try {
    return _mongooseAdapter?.isError(error) ?? false;
  } catch (e) {
    return false;
  }
};

/**
 * Erreur Nodefony — wrapper riche autour de `Error` natif qui ajoute :
 * - Un `code` numérique (HTTP status ou code custom — pas un string).
 * - Un `errorType` détecté automatiquement (TypeError, SystemError,
 *   AssertionError, SequelizeError, MongooseError, ClientError, etc.).
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
 * @remarks Les adapters ORM (Sequelize, Mongoose) sont injectés via
 *   `registerSequelizeAdapter` / `registerMongooseAdapter` pour découpler
 *   le core des modules ORM. Sans adapter, ces types ne sont pas détectés.
 */
class nodefonyError extends Error {
  public override code: number | null;
  public error?: Error;
  public errorType: string;
  //public actual : string
  [key: string]: any;

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
   * Détecte la catégorie d'une erreur (TypeError, SystemError, SequelizeError, etc.).
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
      case isSequelizeError(error):
        return "SequelizeError";
      case isMongooseError(error):
        return "MongooseError";
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
   * `actual/expected/operator` ; SequelizeError → `errors/fields/parent/sql`, etc.
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
        case "SequelizeError":
          this.name = error.name;
          this.message = error.message;
          if (error.errors) {
            this.errors = error.errors || [];
          }
          if (error.fields) {
            this.fields = error.fields;
          }
          if (error.parent) {
            this.parent = error.parent;
            if (this.parent.errno) {
              this.errno = this.parent.errno;
            }
            if (this.parent.code) {
              this.code = this.parent.code;
            }
          }
          if ((error as unknown as Record<string, unknown>).sql) {
            this.sql = (error as unknown as Record<string, unknown>).sql;
          }
          if (error.index) {
            this.index = error.index;
          }
          if (error.value) {
            this.value = error.value;
          }
          if (error.table) {
            this.table = error.table;
          }
          if (error.constraint) {
            this.constraint = error.constraint;
          }
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
   * En `prod`, retourne un message court (type + message) ; sinon, formatage
   * détaillé multi-lignes. Ajoute la stack si `kernel.debug` est actif.
   *
   * @returns string formatée prête pour `console.log` ou syslog.
   */
  override toString(): string {
    let err = "";
    switch (this.errorType) {
      case "Error":
        if (Nodefony.getKernel()?.environment === "prod") {
          return err;
        }
        err = `${clc.blue("Name :")} ${this.name}
        ${clc.blue("Type :")} ${this.errorType}
        ${clc.red("Code :")} ${this.code}
        ${clc.red("Message :")} ${this.message}`;
        break;
      case "SystemError":
        if (Nodefony.getKernel()?.environment === "prod") {
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
        if (Nodefony.getKernel()?.environment === "prod") {
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
        if (Nodefony.getKernel()?.environment === "prod") {
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
      case "SequelizeError":
        return _sequelizeAdapter?.errorToString(this) ?? this.message;
      case "MongooseError":
        return _mongooseAdapter?.errorToString(this) ?? this.message;
      default:
        if (Nodefony.getKernel()?.environment === "prod") {
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
        if (this.errorType === "SequelizeError") {
          break;
        }
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
