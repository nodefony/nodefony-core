/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import nodefony, { kernel } from "./Nodefony";

import { STATUS_CODES } from "node:http";
import { inspect } from "node:util";
import clc from "cli-color";

declare global {
  interface Error {
    errno?: string;
    bytesParsed?: number;
    errors: any[];
    parent: Error;
    sql: any;
    actual: any;
    expected: any;
    operator: any;
    syscall: any;
    address: any;
    port: any;
    rawPacket: any;
    fields: any;
    code: any;
    index: any;
    value: any;
    table: any;
    constraint: any;
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

const isSequelizeError = function (error: Error) {
  try {
    return nodefony.sequelize.isError(error);
  } catch (e) {
    return false;
  }
};

const isMongooseError = function (error: Error) {
  try {
    return nodefony.mongoose.isError(error);
  } catch (e) {
    return false;
  }
};

class nodefonyError extends Error {
  public override code: number | null;
  public error?: Error;
  public errorType: string;
  //public actual : string
  [key: string]: any;

  constructor(message: string | Error, code?: number) {
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

  static isError(error: Error) {
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

  getType(error: Error): string {
    const errorType = nodefonyError.isError(error);
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
          if (error.sql) {
            this.sql = error.sql;
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

  override toString(): string {
    let err = "";
    switch (this.errorType) {
      case "Error":
        if (kernel && kernel.environment === "prod") {
          return err;
        }
        err = `${clc.blue("Name :")} ${this.name}
        ${clc.blue("Type :")} ${this.errorType}
        ${clc.red("Code :")} ${this.code}
        ${clc.red("Message :")} ${this.message}`;
        break;
      case "SystemError":
        if (kernel && kernel.environment === "prod") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message
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
        if (kernel && kernel.environment === "prod") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message
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
        if (kernel && kernel.environment === "prod") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message
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
        return nodefony.sequelize.errorToString(this);
      case "MongooseError":
        return nodefony.mongoose.errorToString(this);
      default:
        if (kernel && kernel.environment === "prod") {
          return ` ${clc.blue("Type :")} ${this.errorType} ${clc.red(
            this.message
          )}`;
        }
        err = `${clc.blue("Name :")} ${this.name}
        ${clc.blue("Type :")} ${this.errorType}
        ${clc.red("Message :")} ${this.message}`;
        break;
    }
    if (kernel?.debug) {
      err += `
        ${clc.green("Stack :")} ${this.stack}`;
    }
    return err;
  }

  parseMessage(message: any) {
    this.errorType = this.getType(message);
    switch (nodefony.typeOf(message)) {
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

  getDefaultMessage() {
    if (!this.message && this.code) {
      const str = this.code.toString();
      if (str in STATUS_CODES) {
        this.message = STATUS_CODES[str] || "";
      }
    }
  }

  logger() {
    return console.log(this.toString());
  }
}

Object.defineProperty(nodefonyError.prototype, "toJSON", jsonNodefony);

export default nodefonyError;
