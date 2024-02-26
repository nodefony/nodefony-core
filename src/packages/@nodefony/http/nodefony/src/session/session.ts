import nodefony, {
  extend,
  Container,
  Severity,
  Msgid,
  Message,
  Pdu,
  ProtoService,
  ProtoParameters,
} from "nodefony";
import sessionService, {
  sessionStrategyType,
  FlashBagSessionType,
  MetaBagSessionType,
  SerializeSessionType,
  sessionStorageInterface,
} from "../../service/sessions/sessions-service";
import HttpKernel, { ContextType } from "../../service/http-kernel";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import Cookie, { CookieOptionsType } from "../cookies/cookie";
import HttpContext from "../context/http/HttpContext";
import WebsocketContext from "../context/websocket/WebsocketContext";
import HttpRequest from "../context/http/Request";

type algorithmSessionType = {
  algorithm: string;
  password: string;
  iv: string;
};

export type OptionsSessionType = {
  name?: string;
  encrypt?: algorithmSessionType;
  use_only_cookies?: boolean;
  use_trans_sid?: boolean;
  use_cookies?: boolean;
  hash_function?: string;
  cookie?: CookieOptionsType;
  use_strict_mode: boolean;
  referer_check: boolean;
};
type StatusSessionType = "none" | "active" | "disabled";

const defaultSessionOptions: OptionsSessionType = {
  name: "nodefony",
  use_only_cookies: true,
  use_trans_sid: true,
  use_cookies: true,
  hash_function: "sha1",
  use_strict_mode: true,
  referer_check: false,
};

class Session extends Container {
  id: string = "";
  name: string = "";
  status: StatusSessionType = "none";
  storage: sessionStorageInterface;
  manager: sessionService;
  saved: boolean = false;
  migrated: boolean = false;
  contextSession: string = "default";
  context?: ContextType;
  created?: Date;
  updated?: Date;
  options: OptionsSessionType;
  cookieSession: Cookie | null | undefined = null;
  applyTranId: boolean = false;
  lifetime?: number;
  flashBag: FlashBagSessionType = {};
  user?: string;
  strategy: sessionStrategyType;
  strategyNone: boolean = false;
  constructor(
    name: string,
    options: OptionsSessionType,
    manager: sessionService
  ) {
    super();
    this.options = extend({}, defaultSessionOptions, options);
    this.manager = manager;
    this.storage = this.manager.storage;
    if (!this.storage) {
      this.status = "disabled";
    }
    this.setName(name);
    this.strategy = this.manager.sessionStrategy;
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = `SESSION ${this.name}`;
    }
    return this.manager.log(pci, severity, msgid, msg);
  }

  async start(context: ContextType, contextSession: string): Promise<this> {
    this.context = context;
    if (!contextSession) {
      // eslint-disable-next-line prefer-destructuring
      contextSession = this.contextSession;
    }
    if (this.options.use_only_cookies) {
      this.applyTranId = true;
    } else {
      this.applyTranId = this.options.use_trans_sid as boolean;
    }
    try {
      const ret = this.checkStatus();
      switch (ret) {
        case false:
          return Promise.resolve(this);
        case "restart":
          return this.start(context, contextSession).catch((e) => {
            throw e;
          });
        default:
          return this.getSession(contextSession).catch((e) => {
            throw e;
          });
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  create(
    lifetime: number,
    id?: string,
    settingsCookie: CookieOptionsType = {}
  ): this {
    this.id = id || this.setId();
    const defaultSetting = extend({}, this.options.cookie);
    settingsCookie = nodefony.extend(defaultSetting, settingsCookie);
    this.log(`NEW SESSION CREATE : ${this.id}`, "DEBUG");
    try {
      this.cookieSession = this.setCookieSession(lifetime, settingsCookie);
      this.setMetasSession(settingsCookie);
      this.status = "active";
      return this;
    } catch (e) {
      this.log(e, "ERROR");
      throw new Error("Request can't create cookieSession");
      // this.log(`,"WARNING")
    }
  }

  async checkChangeContext(contextSession: string): Promise<this> {
    // change context session
    if (contextSession && this.contextSession !== contextSession) {
      this.log(
        `SESSION CONTEXT CHANGE : ${this.contextSession} ==> ${contextSession}`
      );
      switch (this.strategy) {
        case "migrate":
          return this.storage
            .start(this.id, this.contextSession)
            .then(async (result: SerializeSessionType) => {
              this.deSerialize(result);
              if (
                !this.isValidSession(
                  result,
                  this.context as HttpContext | WebsocketContext
                )
              ) {
                this.log(
                  `INVALID SESSION ==> ${this.name} : ${this.id}`,
                  "WARNING"
                );
                await this.destroy().catch((e) => {
                  throw e;
                });
                this.contextSession = contextSession;
                return this.create(this.lifetime as number);
              }
              await this.removeSession();
              this.log(
                `STRATEGY MIGRATE SESSION  ==> ${this.name} : ${this.id}`,
                "DEBUG"
              );
              this.migrated = true;
              this.contextSession = contextSession;
              return this.create(this.lifetime as number);
            })
            .catch((error: Error) => {
              throw error;
            });
        case "invalidate":
          this.log(
            `STRATEGY INVALIDATE SESSION ==> ${this.name} : ${this.id}`,
            "DEBUG"
          );
          await this.destroy().catch((e) => {
            throw e;
          });
          this.contextSession = contextSession;
          return new Promise((resolve, reject) => {
            try {
              resolve(this.create(this.lifetime as number));
            } catch (e) {
              reject(e);
            }
          });
        case "none":
          this.strategyNone = true;
          break;
        default:
      }
      if (!this.strategyNone) {
        return this;
      }
    }
    return this.storage
      .start(this.id, this.contextSession)
      .then(async (result: SerializeSessionType) => {
        try {
          if (result && Object.keys(result).length) {
            this.deSerialize(result);
            if (
              !this.isValidSession(
                result,
                this.context as HttpContext | WebsocketContext
              )
            ) {
              this.log(
                `SESSION ==> ${this.name} : ${this.id}  session invalid `,
                "ERROR"
              );
              await this.invalidate().catch((e) => {
                throw e;
              });
            }
          } else if (this.options.use_strict_mode) {
            if (!this.strategyNone) {
              this.log(
                `SESSION ==> ${this.name} : ${this.id} use_strict_mode `,
                "ERROR"
              );
              await this.invalidate().catch((e) => {
                throw e;
              });
            }
          }
          this.status = "active";
          return this;
        } catch (e) {
          throw e;
        }
      })
      .catch(async (error: Error) => {
        if (error) {
          try {
            this.log(`SESSION ==> ${this.name} : ${this.id} ${error}`, "ERROR");
            if (!this.strategyNone) {
              await this.invalidate().catch((e: Error) => {
                throw e;
              });
            }
            throw error;
          } catch (e) {
            throw error;
          }
        }
        throw error;
      });
  }

  async invalidate(
    lifetime: number = this.lifetime as number,
    id?: string,
    settingsCookie: CookieOptionsType = {}
  ) {
    this.log(`INVALIDATE SESSION ==>${this.name} : ${this.id}`, "DEBUG");
    this.saved = true;
    return await this.destroy(!!this.cookieSession)
      .then(() => {
        this.saved = false;
        return this.create(lifetime, id, settingsCookie);
      })
      .catch((e: Error) => {
        throw e;
      });
  }

  setId(): string {
    let ip = "";
    try {
      ip = (
        this.context as HttpContext | WebsocketContext
      )?.getRemoteAddress() as string;
    } catch (e) {
      this.log(e, "DEBUG");
    }
    const date = new Date().getTime();
    // eslint-disable-next-line no-mixed-operators
    const concat = ip + date + this.randomValueHex(16) + Math.random() * 10;
    let hash = null;
    switch (this.options.hash_function) {
      case "md5":
        hash = createHash("md5");
        break;
      case "sha1":
        hash = createHash("sha1");
        break;
      default:
        hash = createHash("md5");
    }
    const res = hash.update(concat).digest("hex");
    return this.encrypt(`${res}:${this.contextSession}`);
  }

  getId(value: string) {
    const res = this.decrypt(value);
    // eslint-disable-next-line prefer-destructuring
    this.contextSession = res.split(":")[1];
    return value;
  }

  async getSession(contextSession: string): Promise<this> {
    if (this.options.use_cookies) {
      if (this.context?.cookieSession) {
        this.id = this.getId(this.context.cookieSession.value);
        this.cookieSession = this.context.cookieSession;
      }
      this.applyTranId = false;
    }
    if (!this.options.use_only_cookies && !this.id) {
      const request = this.context?.request as HttpRequest;
      if (request && this.name in request.query) {
        this.id = this.getId(request.query[this.name]);
      }
    }
    if (this.id) {
      return this.checkChangeContext(contextSession).catch((e) => {
        throw e;
      });
    }
    try {
      this.clear();
      return this.create(this.lifetime as number);
    } catch (e) {
      throw e;
    }
  }

  isValidSession(data: SerializeSessionType, context: ContextType): boolean {
    if (this.options.referer_check) {
      try {
        return this.checkSecureReferer(context);
      } catch (e) {
        this.log(
          `SESSION REFERER ERROR SESSION  ==> ${this.name} : ${this.id}`,
          "WARNING"
        );
        return false;
      }
    }
    // console.log( this.updated , new Date(this.updated) )
    const lastUsed = new Date(this.updated as Date).getTime();
    // let lastUsed = new Date(this.getMetaBag("lastUsed")).getTime();
    const now = new Date().getTime();
    if (this.lifetime === 0) {
      // if ( lastUsed && lastUsed + ( this.settings.gc_maxlifetime * 1000 ) < now ){
      //     this.manager.log("SESSION INVALIDE gc_maxlifetime    ==> " + this.name + " : "+ this.id, "WARNING");
      //     return false ;
      // }
      return true;
    }
    // eslint-disable-next-line no-mixed-operators
    if (lastUsed && lastUsed + (this.lifetime as number) * 1000 < now) {
      this.log(
        `SESSION INVALIDE lifetime   ==> ${this.name} : ${this.id}`,
        "WARNING"
      );
      return false;
    }
    return true;
  }

  checkSecureReferer(context: ContextType): boolean {
    let host = (context as HttpContext | WebsocketContext).getHost();
    const meta = this.getMetaBag("host");
    if (host === meta) {
      return true;
    }
    this.log(
      `SESSION START WARNING REFERRER NOT SAME, HOST : ${host} ,META STORAGE :${meta}`,
      "WARNING"
    );
    throw {
      meta,
      host,
    };
  }

  async delete(cookieDelete?: boolean): Promise<boolean> {
    return this.destroy(cookieDelete);
  }

  async destroy(cookieDelete?: boolean): Promise<boolean> {
    this.clear();
    return this.removeSession(cookieDelete);
  }

  async removeSession(cookieDelete: boolean = false): Promise<boolean> {
    if (this.saved === true) {
      return this.storage
        .destroy(this.id, this.contextSession)
        .then(() => {
          if (cookieDelete) {
            this.deleteCookieSession();
          }
          this.saved = true;
          return true;
        })
        .catch((e: Error) => {
          this.log(e, "ERROR");
          throw e;
        });
    }
    if (cookieDelete) {
      this.deleteCookieSession();
    }
    return Promise.resolve(true);
  }

  setCookieSession(leftTime: number, options: CookieOptionsType = {}) {
    if (this.context && this.context.response) {
      // let settings = null;
      const defaultsettings = nodefony.extend({}, this.options.cookie);
      options = nodefony.extend(defaultsettings, options);
      if (leftTime) {
        options.maxAge = leftTime;
      }
      const cookie = new Cookie(this.name, this.id, options);
      this.context.response.addCookie(cookie);
      this.cookieSession = cookie;
      this.context.cookieSession = cookie;
      return cookie;
    }
    return null;
  }

  deleteCookieSession() {
    if (this.context && this.context.response) {
      let cookie: Cookie = this.cookieSession as Cookie;
      if (cookie) {
        cookie.expires = new Date(0) as Date;
      } else {
        // eslint-disable-next-line new-cap
        cookie = new Cookie(this.name, "", {
          expires: new Date(0),
          // path: "/"
        });
      }
      this.context.response.setCookie(cookie as Cookie);
      this.cookieSession = null;
      this.context.cookieSession = null;
      return cookie;
    }
    return this.cookieSession;
  }

  clear() {
    super.reset();
    this.clearFlashBags();
  }

  getName() {
    return this.name;
  }

  encrypt(text: string): string {
    //console.log("encrypt", text);
    const cipher = createCipheriv(
      "aes-256-ctr",
      this.manager.secret as Buffer,
      this.manager.iv as Buffer
    );
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  }

  decrypt(text: string): string {
    //console.log("decrypt", text);
    const decipher = createDecipheriv(
      "aes-256-ctr",
      this.manager.secret as Buffer,
      this.manager.iv as Buffer
    );

    let decrypted = decipher.update(text, "hex", "utf8");
    //console.log(decipher, decrypted);
    decrypted += decipher.final("utf8");
    //console.log(decrypted.toString());
    return decrypted;
  }

  checkStatus(): "restart" | boolean {
    switch (this.status) {
      case "active":
        this.log(
          `SESSION ALLREADY STARTED ==> ${this.name} : ${this.id}`,
          "WARNING"
        );
        return false;
      case "disabled":
        try {
          this.storage = this.manager.initializeStorage();
          if (this.storage) {
            this.status = "none";
            return "restart";
          }
        } catch (e) {
          this.log("SESSION STORAGE HANDLER NOT FOUND ", "ERROR");
          throw new Error("SESSION STORAGE HANDLER NOT FOUND ");
        }
        break;
      default:
        return true;
    }
    return true;
  }

  setName(name: string) {
    this.name = name || (this.options.name as string);
  }

  async save(user: string, contextSession: string) {
    return this.storage
      .write(this.id, this.serialize(user), contextSession)
      .then((session: any) => {
        this.created = session.createdAt;
        this.updated = session.updatedAt;
        if (!this.context) {
          throw new Error("SAVE SESSION ERROR context already deleted ");
        } else {
          this.saved = true;
          if (this.context) {
            this.context.fire("onSaveSession", this);
          }
          return this;
        }
      })
      .catch((error: Error) => {
        // console.trace(error);
        // this.log(error, "ERROR");
        this.saved = false;
        throw error;
      });
  }

  setMetasSession(cookieSetting: CookieOptionsType = {}): void {
    // let time = new Date();
    let ua = null;
    this.setMetaBag(
      "lifetime",
      cookieSetting.maxAge || this.options?.cookie?.maxAge
    );
    this.setMetaBag("context", this.contextSession || null);
    const type = (this.context as HttpContext | WebsocketContext)
      ?.type as string;
    this.setMetaBag("request", type);
    // this.setMetaBag("created", time);
    try {
      const ip = (
        this.context as HttpContext | WebsocketContext
      )?.getRemoteAddress() as string;
      const host = (
        this.context as HttpContext | WebsocketContext
      )?.getHost() as string;
      const agent = (
        this.context as HttpContext | WebsocketContext
      )?.getUserAgent() as string;

      this.setMetaBag("remoteAddress", ip);
      this.setMetaBag("host", host);
      if (agent) {
        this.setMetaBag("user_agent", agent);
      } else {
        this.setMetaBag("user_agent", "Not Defined");
      }
    } catch (e) {
      this.log(e, "DEBUG");
    }
  }

  attributes() {
    return this.protoService.prototype;
  }

  getAttributes() {
    return this.attributes();
  }

  metaBag(): MetaBagSessionType {
    return this.protoParameters.prototype;
  }

  getMetas(): MetaBagSessionType {
    return this.metaBag();
  }

  setMetaBag(key: string, value: any) {
    return this.setParameters(key, value);
  }

  getMetaBag(key: string): any {
    return this.getParameters(key);
  }

  clearFlashBags() {
    this.flashBag = {};
  }

  getFlashBag(key: string): any {
    // this.log("GET FlashBag : " + key ,"WARNING")
    const res = this.flashBag[key];
    if (res) {
      this.log(`Delete FlashBag : ${key}`, "DEBUG");
      delete this.flashBag[key];
      return res;
    }
    return null;
  }

  setFlashBag(key: string, value: any): any {
    if (!key) {
      throw new Error(`FlashBag key must be define : ${key}`);
    }
    if (!value) {
      this.log(`ADD FlashBag  : ${key} value not defined `, "WARNING");
    } else {
      this.log(`ADD FlashBag : ${key}`, "DEBUG");
    }
    this.flashBag[key] = value;
    return value;
  }

  flashBags(): FlashBagSessionType {
    return this.flashBag;
  }

  clearFlashBag(key: string) {
    if (!key) {
      throw new Error(`clearFlashBag key must be define : ${key}`);
    }
    if (this.flashBag[key]) {
      delete this.flashBag[key];
    }
  }

  serialize(user: string): SerializeSessionType {
    const obj = {
      Attributes: this.services as ProtoService,
      metaBag: this.parameters as ProtoParameters,
      flashBag: this.flashBag,
      user,
    };
    return obj;
  }

  deSerialize(obj: Record<string, any>): void {
    // var obj = JSON.parse(data);
    for (const attr in obj.Attributes) {
      this.set(attr, obj.Attributes[attr]);
    }
    for (const meta in obj.metaBag) {
      // console.log(meta + " : " + obj.metaBag[meta])
      this.setMetaBag(meta, obj.metaBag[meta]);
    }
    for (const flash in obj.flashBag) {
      this.setFlashBag(flash, obj.flashBag[flash]);
    }
    this.created = obj.created;
    this.updated = obj.updated;
    this.user = obj.user;
  }

  randomValueHex(len: number) {
    return randomBytes(Math.ceil(len / 2))
      .toString("hex") // convert to hexadecimal format
      .slice(0, len); // return required number of characters
  }
}

export default Session;
