import cookieLib from "cookie";
import MS, { StringValue } from "ms";
import { extend } from "nodefony";
const encode = encodeURIComponent;
const decode = decodeURIComponent;
import crypto from "node:crypto";
import HttpContext from "../context/http/HttpContext";
import WebsocketContext from "../context/websocket/WebsocketContext";
import { ICookie } from "websocket";
import { ContextType } from "../../service/http-kernel";

type SameSiteType = boolean | "none" | "Lax" | "Strict";
type PriorityType = "High" | "Medium" | "Low" | undefined;

declare module "websocket" {
  interface request {
    //cookies: Record<string, Cookie>;
  }
}

declare module "http" {
  interface IncomingMessage {
    cookies: Record<string, Cookie>;
  }
}

declare module "http2" {
  interface Http2ServerRequest {
    cookies: Record<string, Cookie>;
  }
}

export interface CookieOptionsType {
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  expires?: Date | string | number;
  sameSite?: SameSiteType;
  httpOnly?: boolean;
  signed?: boolean;
  secret?: string;
  priority?: PriorityType;
}

const cookieDefaultSettings: CookieOptionsType = {
  maxAge: 0, // 24*60*60,
  path: "/",
  domain: undefined,
  secure: true,
  sameSite: "Lax",
  httpOnly: true,
  signed: false,
  secret: "!nodefony.secret!",
};

function parser(strToParse: string, options?: any) {
  return cookieLib.parse(strToParse, options);
}
// function parserWs(tab: websocket.ICookie[]): Record<string, string> {
//   const ele = {};
//   for (const ele of tab) {
//     ele;
//   }
//   return ele;
// }

// function getRequestcookies(context: ContextType) {
//   let cookies = null;
//   switch (context.type) {
//     case "http":
//     case "https":
//     case "http2":
//       if (
//         (context as HttpContext).request.request &&
//         (context as HttpContext).request.request.headers.cookie
//       ) {
//         cookies = (context as HttpContext).request.request.headers.cookie;
//       }
//       if (cookies) return parser(cookies);
//       break;
//     case "websocket":
//     case "websocket-secure":
//       if ((context as WebsocketContext).request?.cookies) {
//         cookies = (context as WebsocketContext).request?.cookies;
//       }
//       if (cookies) return parserWs(cookies);
//       break;
//     default:
//       throw new Error("getRequestcookies Bad Type");
//   }
// }

function cookiesParser(context: ContextType) {
  let cookies = null;
  let co = null;
  switch (context.type) {
    case "http":
    case "https":
    case "http2":
      if (
        (context as HttpContext).request.request &&
        (context as HttpContext).request.request.headers.cookie
      ) {
        cookies = (context as HttpContext).request.request.headers.cookie;
      }
      if (cookies) {
        const obj = parser(cookies);
        for (const cookie in obj) {
          co = new Cookie(cookie, obj[cookie]);
          (context as HttpContext).addRequestCookie(co);
        }
        if (context.response) {
          (context as HttpContext).request.request.cookies =
            context.response.cookies;
        }
      }
      break;
    case "websocket":
    case "websocket-secure":
      if ((context as WebsocketContext).request?.cookies) {
        cookies = (context as WebsocketContext).request?.cookies;
      }
      if (cookies) {
        for (let i = 0; i < cookies.length; i++) {
          co = new Cookie(cookies[i].name, cookies[i].value);
          (context as WebsocketContext).addRequestCookie(co);
        }
      }
      break;
    default:
      throw new Error("cookiesParser Bad Type");
  }
}

class Cookie {
  options: CookieOptionsType = {};
  name: string;
  signed?: boolean;
  value: any;
  originalMaxAge?: number;
  expires?: Date;
  maxAge?: number;
  path?: string;
  domain: string | undefined;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSiteType;
  priority?: string;

  constructor(cookies: Cookie);
  constructor(name: string, value: any, options?: CookieOptionsType);
  constructor(
    cookiesOrName: Cookie | string,
    value?: any,
    options?: CookieOptionsType
  ) {
    this.options = extend({}, cookieDefaultSettings, options || {});
    if (!cookiesOrName) {
      throw new Error("cookie must have name");
    }
    this.name = cookiesOrName as string;
    if (typeof cookiesOrName === "string") {
      if (!cookiesOrName) {
        throw new Error("cookie must have name");
      }
      this.name = cookiesOrName;
      this.signed = this.options.signed;
      this.value = this.setValue(value);
      if (this.options.maxAge) {
        this.originalMaxAge = this.setOriginalMaxAge(this.options.maxAge);
      } else {
        this.originalMaxAge = undefined;
      }
      this.expires = this.setExpires(this.options.expires);
      this.path = this.setPath(this.options.path);
      this.domain = this.setDomain();
      this.httpOnly = this.setHttpOnly(this.options.httpOnly);
      this.secure = this.setSecure(this.options.secure);
      this.sameSite = this.setSameSite(this.options.sameSite);
      this.priority = this.setPriority(this.options.priority);
    }
    if (cookiesOrName instanceof Cookie) {
      this.options = cookiesOrName.options;
      this.name = cookiesOrName.name;
      this.signed = cookiesOrName.signed;
      this.value = cookiesOrName.value;
      this.originalMaxAge = cookiesOrName.originalMaxAge;
      this.expires = cookiesOrName.expires;
      this.path = cookiesOrName.path;
      this.domain = cookiesOrName.domain;
      this.httpOnly = cookiesOrName.httpOnly;
      this.secure = cookiesOrName.secure;
      this.maxAge = cookiesOrName.maxAge;
      this.sameSite = cookiesOrName.sameSite;
      this.priority = cookiesOrName.priority;
    }
  }

  clearCookie(): void {
    this.setExpires(1);
    this.path = "/";
  }

  setValue(value: any): any {
    if (value) {
      value = decode(value);
    }
    if (this.signed) {
      this.value = this.sign(value, this.options.secret as string);
    } else {
      this.value = value;
    }
    return this.value;
  }

  setSecure(val: boolean | undefined): boolean {
    return !!val;
  }

  setDomain() {
    return this.options.domain;
  }

  setHttpOnly(val: boolean | undefined): boolean {
    return !!val;
  }

  setPath(val: string | undefined): string | undefined {
    return val;
  }

  setSameSite(val: SameSiteType | undefined): SameSiteType {
    return val ? val : "none";
  }

  setExpires(date: Date | string | number | undefined): Date | undefined {
    if (date) {
      try {
        if (date instanceof Date) {
          this.expires = date;
        } else {
          this.expires = new Date(date);
        }
      } catch (e) {
        this.expires = undefined;
      }
    } else {
      const maxage = this.getMaxAge();
      if (maxage === 0) {
        this.expires = undefined;
      } else {
        const res = (new Date().getTime() + (maxage || 0)) * 1000;
        this.expires = new Date(res);
      }
      return this.expires;
    }
    this.getMaxAge();
    return this.expires;
  }

  setOriginalMaxAge(ms: number | StringValue): number {
    if (typeof ms === "number") {
      return ms;
    }
    const converted = ms as StringValue;
    return MS(converted) / 1000;
  }

  setPriority(val: PriorityType): PriorityType {
    return val;
  }

  getMaxAge(): number | undefined {
    if (this.expires && this.expires instanceof Date) {
      const ms = this.expires.getTime() - new Date().getTime();
      const s = ms / 1000;
      if (s > 0) {
        this.maxAge = s; // en seconde
      } else {
        this.maxAge = undefined;
        // throw new Error(`Espires / Max-Age : ${s} Error Espires`);
      }
    } else {
      this.maxAge = this.originalMaxAge;
    }
    return this.maxAge;
  }

  toString() {
    return `${this.name}=${encode(this.value)}`;
  }

  sign(val: string, secret: string): string {
    if (typeof val !== "string") {
      throw new TypeError("cookie required");
    }
    if (typeof secret !== "string") {
      throw new TypeError("secret required");
    }
    return crypto
      .createHmac("sha256", `${val}.${secret}`)
      .update(val)
      .digest("base64")
      .replace(/[=]+$/u, "");
  }

  unsign(val: string, secret: string): string | boolean {
    if (val && typeof val !== "string") {
      throw new Error("unsign cookie value bad type !! ");
    }
    if (secret && typeof secret !== "string") {
      throw new Error("unsign cookie secret bad type");
    }
    if (!val) {
      val = this.value;
    }
    if (!secret) {
      secret = this.options.secret as string;
    }
    return this.sign(val, secret) === val ? val : false;
  }

  serialize(): string {
    const tab = [];
    tab.push(this.toString());
    if (this.maxAge) {
      tab.push(`Max-Age=${this.maxAge}`);
    }
    if (this.domain) {
      tab.push(`Domain=${this.domain}`);
    }
    if (this.path) {
      tab.push(`Path=${this.path}`);
    }
    if (this.sameSite) {
      tab.push(`SameSite=${this.sameSite}`);
    }
    if (this.expires) {
      tab.push(`Expires=${this.expires.toUTCString()}`);
    }
    if (this.httpOnly) {
      tab.push("HttpOnly");
    }
    if (this.secure) {
      tab.push("Secure");
    }
    if (this.priority) {
      tab.push(`Priority=${this.priority}`);
    }
    return tab.join("; ");
  }

  serializeWebSocket(): ICookie {
    const obj: ICookie = {
      name: this.name,
      value: this.value,
    };
    if (this.maxAge) {
      obj.maxage = this.maxAge;
    }
    if (this.domain) {
      obj.domain = this.domain;
    }
    if (this.path) {
      obj.path = this.path;
    }
    if (this.sameSite) {
      //@ts-ignore
      obj.samesite = this.sameSite;
    }
    if (this.expires) {
      obj.expires = this.expires; // .toUTCString();
    }
    if (this.httpOnly) {
      obj.httponly = true;
    }
    if (this.secure) {
      obj.secure = true;
    }
    if (this.priority) {
      //@ts-ignore
      obj.priority = this.priority;
    }
    return obj;
  }
}

export default Cookie;
export { cookiesParser, parser /*parserWs */ /*getRequestcookies*/ };
