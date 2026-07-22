import { parseCookie } from "cookie";
import MS, { StringValue } from "ms";
import { extend } from "nodefony";
const encode = encodeURIComponent;
const decode = decodeURIComponent;
import crypto from "node:crypto";
import HttpContext from "../context/http/HttpContext";
import WebsocketContext from "../context/websocket/WebsocketContext.js";
import { ContextType } from "../../service/http-kernel.js";
import type {
  ICookie as ICookieInterface,
  ICookieOptions,
  IWsCookie,
  PriorityType,
  SameSiteType,
} from "../../interfaces/ICookie";

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

/**
 * Options d'un cookie — alias du contrat public {@link ICookieOptions}.
 *
 * Conservé sous ce nom parce que `session.ts` et l'historique du module
 * l'importent ainsi ; ce n'est PAS une seconde définition. Un consommateur
 * externe nomme le type par `ICookieOptions`, exporté au barrel.
 */
export type CookieOptionsType = ICookieOptions;

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
  return parseCookie(strToParse, options);
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
    case "websocket-secure": {
      const wsReq = (context as WebsocketContext).request;
      const cookieHeader = wsReq?.headers?.cookie;
      if (cookieHeader) {
        const parsed = parser(cookieHeader);
        for (const name in parsed) {
          co = new Cookie(name, parsed[name]);
          (context as WebsocketContext).addRequestCookie(co);
        }
      }
      break;
    }
    default:
      throw new Error("cookiesParser Bad Type");
  }
}

class Cookie implements ICookieInterface {
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
    options?: CookieOptionsType,
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
      const secret = this.options.secret as string;
      // Zero Trust : refuser de signer avec le secret par défaut prévisible —
      // une signature avec un secret public ne protège rien (fail-closed).
      if (!secret || secret === cookieDefaultSettings.secret) {
        throw new Error(
          "signed cookie requires a configured secret (refusing the default/predictable secret)",
        );
      }
      // Préfixe `s:` = marqueur de cookie signé (déballé par unsign()).
      this.value = `s:${this.sign(value, secret)}`;
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

  /**
   * Normalise l'attribut `SameSite` vers une valeur canonique RFC 6265bis.
   *
   * Fallback **`Lax`** (jamais `None`) : `None` désactive la protection CSRF et
   * impose `Secure` — ce n'est jamais un défaut sûr. Toute entrée inconnue
   * (ancien `boolean`, casse libre) retombe sur `Lax` (fail-safe).
   *
   * @param val - valeur souhaitée (`Strict` / `Lax` / `None`, casse libre).
   * @returns la forme canonique title-case.
   */
  setSameSite(val: SameSiteType | undefined): SameSiteType {
    if (!val) {
      return "Lax";
    }
    switch (String(val).toLowerCase()) {
      case "strict":
        return "Strict";
      case "none":
        return "None";
      default:
        return "Lax";
    }
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
      if (!maxage) {
        this.expires = undefined;
      } else {
        const res = new Date().getTime() + maxage * 1000;
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

  /**
   * Signe une valeur de cookie : `HMAC-SHA256(value)` clé = `secret`, encodé en
   * base64url (sûr en cookie, pas de `=`/`+`/`/`). Retourne `value.signature`
   * → la valeur d'origine est PRÉSERVÉE (récupérable via {@link unsign}).
   *
   * @param val - valeur en clair à signer.
   * @param secret - clé HMAC (le secret, JAMAIS la valeur).
   * @returns `value.base64url(hmac)`.
   * @throws {TypeError} si `val` n'est pas une string ou `secret` est vide.
   */
  sign(val: string, secret: string): string {
    if (typeof val !== "string") {
      throw new TypeError("cookie value required (string)");
    }
    if (typeof secret !== "string" || !secret) {
      throw new TypeError("cookie secret required (non-empty string)");
    }
    const mac = crypto
      .createHmac("sha256", secret)
      .update(val)
      .digest("base64url");
    return `${val}.${mac}`;
  }

  /**
   * Vérifie et déballe une valeur signée par {@link sign} (tolère le préfixe
   * `s:`). Comparaison **timing-safe** (`crypto.timingSafeEqual`).
   *
   * @param val - valeur signée (`value.signature`, éventuellement préfixée `s:`).
   *   Défaut : `this.value`.
   * @param secret - clé HMAC. Défaut : `this.options.secret`.
   * @returns la valeur en clair si la signature est valide, sinon `false`.
   * @throws {TypeError} si les types sont invalides ou le secret est vide.
   */
  unsign(val?: string, secret?: string): string | false {
    let input = val ?? (this.value as string);
    const key = secret ?? (this.options.secret as string);
    if (typeof input !== "string") {
      throw new TypeError("unsign cookie value bad type");
    }
    if (typeof key !== "string" || !key) {
      throw new TypeError("unsign cookie secret required (non-empty string)");
    }
    if (input.startsWith("s:")) {
      input = input.slice(2);
    }
    const idx = input.lastIndexOf(".");
    if (idx <= 0) {
      return false;
    }
    const plain = input.slice(0, idx);
    const expected = this.sign(plain, key);
    const a = Buffer.from(input);
    const b = Buffer.from(expected);
    // Longueur d'abord : timingSafeEqual throw si tailles ≠ ; la longueur seule
    // ne révèle pas le secret.
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b) ? plain : false;
  }

  serialize(): string {
    const tab = [];
    tab.push(this.toString());
    // Préfixes RFC 6265bis §4.1.3 : `__Host-` lie le cookie à l'origine exacte
    // (Secure + Path=/ + AUCUN Domain → anti session-fixation cross-subdomain) ;
    // `__Secure-` impose seulement Secure. Le navigateur REJETTE le cookie si
    // ces contraintes ne sont pas respectées → on les force ici.
    const hostPrefix = this.name.startsWith("__Host-");
    const securePrefix = this.name.startsWith("__Secure-");
    // `SameSite=None` et les deux préfixes IMPOSENT `Secure` (RFC 6265bis).
    const secure =
      this.secure || this.sameSite === "None" || hostPrefix || securePrefix;
    if (this.maxAge) {
      tab.push(`Max-Age=${this.maxAge}`);
    }
    // `__Host-` interdit l'attribut Domain.
    if (this.domain && !hostPrefix) {
      tab.push(`Domain=${this.domain}`);
    }
    // `__Host-` impose Path=/.
    const path = hostPrefix ? "/" : this.path;
    if (path) {
      tab.push(`Path=${path}`);
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
    if (secure) {
      tab.push("Secure");
    }
    if (this.priority) {
      tab.push(`Priority=${this.priority}`);
    }
    return tab.join("; ");
  }

  serializeWebSocket(): IWsCookie {
    const hostPrefix = this.name.startsWith("__Host-");
    const securePrefix = this.name.startsWith("__Secure-");
    const secure =
      this.secure || this.sameSite === "None" || hostPrefix || securePrefix;
    const obj: IWsCookie = {
      name: this.name,
      value: this.value,
    };
    if (this.maxAge) obj.maxage = this.maxAge;
    // `__Host-` interdit Domain et impose Path=/ (cf serialize()).
    if (this.domain && !hostPrefix) obj.domain = this.domain;
    const path = hostPrefix ? "/" : this.path;
    if (path) obj.path = path;
    if (this.expires) obj.expires = this.expires;
    if (this.httpOnly) obj.httponly = true;
    if (secure) obj.secure = true;
    return obj;
  }
}

export default Cookie;
export { cookiesParser, parser /*parserWs */ /*getRequestcookies*/ };
