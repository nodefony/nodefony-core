import nodefony, {
  extend,
  Service,
  //Kernel,
  Container,
  Event,
  Module,
  // FamilyType,
  //DynamicService,
  ProtoService,
  ProtoParameters,
  inject,
} from "nodefony";
import HttpKernel, {
  //ProtocolType,
  //ServerType,
  ContextType,
  //httpRequest,
} from "../http-kernel";
import Context, { HTTPMethod } from "../../src/context/Context";
import Session, { OptionsSessionType } from "../../src/session/session";
import Http2Request from "../../src/context/http2/Request";
import HttpRequest from "../../src/context/http/Request";
import url from "node:url";
import Certificate from "../../service/certificates";
import { createHash } from "node:crypto";
import { sequelizeStorage } from "@nodefony/sequelize";
import { mongooseStorage } from "@nodefony/mongoose";

import FileSessionStorage from "../../src/session/storage/FileSessionStorage";

export type sessionStrategyType = "none" | "migrate" | "invalidate";
export type sessionStorageType = any; //  "orm" | "memcached" | "redis" | "fileSystem" | "memory";

export type FlashBagSessionType = Record<string, any>;
export type MetaBagSessionType = Record<string, any>;
export interface SerializeSessionType {
  Attributes: ProtoService;
  metaBag: ProtoParameters;
  flashBag: FlashBagSessionType;
  user: string;
}

export interface sessionStorageInterface {
  read: (name: string) => Promise<SerializeSessionType>;
  write: (
    name: string,
    serialize: SerializeSessionType,
    contextSession: string
  ) => Promise<SerializeSessionType>;
  start: (id: string, contextSession: string) => Promise<SerializeSessionType>;
  open: (contextSession: string) => Promise<number>;
  close: () => boolean;
  destroy: (id: string, contextSession: string) => Promise<boolean>;
  gc: (maxlifetime: number, contextSession: string) => Promise<void>;
}

class SessionsService extends Service {
  sessionStrategy: sessionStrategyType = "migrate";
  storage: any = null;
  gc_probability: number = 1;
  gc_divisor: number = 100;
  module: Module;
  defaultSessionName: string = "nodefony";
  sessionAutoStart: string | boolean = false;
  secret?: Buffer;
  iv?: Buffer;
  certificates: Certificate;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel
  ) {
    super(
      "sessions",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.session
    );
    this.module = module;
    this.certificates = this.get("certificates");
    this.gc_probability =
      this.options.gc_probability === "string"
        ? parseInt(this.options.gc_probability, 10)
        : this.options.gc_probability;
    this.gc_divisor = this.options.gc_divisor;
    this.defaultSessionName = this.options.name;
    this.sessionAutoStart = this.setAutoStart(this.options.start);
    this.once("onTerminate", () => {
      if (this.storage) {
        this.storage.close();
      }
    });
  }

  async initialize(): Promise<this> {
    this.secret = this.createSecret();
    this.iv = this.createIv();
    this.initializeStorage();
    return this;
  }

  initializeStorage(): sessionStorageInterface {
    let storage: any = null;
    switch (this.options.handler) {
      case "orm":
      case "ORM":
        //storage = nodefony.session.storage[this.kernel?.getOrm()];
        break;
      case "sequelize":
        storage = sequelizeStorage;
        break;
      case "mongoose":
        storage = mongooseStorage;
        break;
      case "files":
        storage = FileSessionStorage;
        break;
      default:
        throw new Error(`Session Storage not found `);
    }
    try {
      if (storage) {
        this.storage = new storage(this);
        this.kernel?.on("onReady", async () => {
          await this.storage.open("default");
        });
      } else {
        this.storage = null;
        this.log(
          `SESSION HANDLER STORAGE NOT FOUND :${this.options.handler}`,
          "ERROR"
        );
      }
      return this.storage;
    } catch (e) {
      throw e;
    }
  }

  createSecret(): Buffer {
    const secret = createHash("sha512")
      .update(this.certificates?.key as Buffer)
      .digest();
    return Buffer.from(secret.buffer.slice(0, 32));
  }

  createIv(): Buffer {
    const iv = createHash("sha512")
      .update(this.certificates?.publicKeyPem as Buffer)
      .digest();
    return Buffer.from(iv.buffer.slice(0, 16));
  }

  setAutoStart(auto: string | null | undefined | boolean): string | false {
    switch (auto) {
      case true:
      case "":
      case undefined:
        return "default";
      case false:
      case null:
        return false;
      default:
        if (typeof auto === "string") {
          return auto;
        }
        throw new Error(`Session start settings config error : ${auto}`);
    }
  }

  async start(
    context: ContextType,
    sessionContext: string
  ): Promise<Session | null> {
    return new Promise((resolve, reject) => {
      if (context.sessionStarting) {
        if (context.session) {
          resolve(context.session);
          return;
        }
        context.once("onSessionStart", (session: Session, error: Error) => {
          if (session) {
            return resolve(session);
          }
          return reject(error || new Error("Bad Session"));
        });
        return;
      }
      if (context.session) {
        if (context.session.status === "active") {
          this.log(
            `SESSION ALLREADY STARTED ==> ${context.session.name} : ${context.session.id}`,
            "DEBUG"
          );
          resolve(context.session);
          return;
        }
      }
      let inst = null;
      try {
        context.sessionStarting = true;
        sessionContext = this.setAutoStart(sessionContext) as string;
        if (this.probaGarbage()) {
          this.storage.gc(this.options.gc_maxlifetime, sessionContext);
        }
        inst = this.createSession(this.defaultSessionName);
      } catch (e) {
        context.fire("onSessionStart", null, e);
        reject(e);
        throw e;
      }
      inst
        .start(context, sessionContext)
        .then((session) => {
          try {
            context.session = session;
            const method = context.method as HTTPMethod;
            const request = context.request as HttpRequest | Http2Request;
            if (method !== "WEBSOCKET" && request && request.request) {
              request.request.session = session;
            }
            context.sessionStarting = false;
            session.setMetaBag("url", url.parse(context.url));
            if (context.cleaned) {
              return reject(new Error("context already cleaned"));
            }
            context.fire("onSessionStart", session, null);
            return resolve(session);
          } catch (e) {
            if (context.cleaned) {
              return reject(e);
            }
            context.fire("onSessionStart", null, e);
            return reject(e);
          }
        })
        .catch((err) => {
          //console.error(err);
          if (context.cleaned) {
            return reject(err);
          }
          context.fire("onSessionStart", null, err);
          return reject(err);
        });
    });
  }

  saveSession(context: ContextType): Promise<Session | null> {
    //console.log(`SERVICE SESSION : SAVED : ${context.session?.saved}`);
    if (context.session) {
      if (!context.session.saved) {
        return context.session.save(
          context.user ? context.user : null,
          context.session.contextSession
        );
      }
    }
    return Promise.resolve(null);
  }

  createSession(name: string, options?: OptionsSessionType): Session {
    try {
      options = extend({}, this.options, options);
      return new Session(name, options as OptionsSessionType, this);
    } catch (e) {
      throw e;
    }
  }

  addContextSession(context: ContextType) {
    if (this.storage) {
      this.once("onReady", () => {
        this.storage.open(context);
      });
    }
  }

  setSessionStrategy(strategy: sessionStrategyType) {
    this.sessionStrategy = strategy;
  }

  probaGarbage(): boolean {
    // Génère un nombre aléatoire entre 0 et 100
    const random = Math.floor(Math.random() * 100) + 1;
    // Si le nombre aléatoire est inférieur ou égal à gc_probability
    if (random <= this.gc_probability) {
      return true;
    }
    return false;
  }
}

export default SessionsService;
