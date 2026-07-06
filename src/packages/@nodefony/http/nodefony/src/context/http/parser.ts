import HttpRequest from "./Request";
import Http2Request from "../http2/Request";
import QS from "qs";
import { extend } from "nodefony";
import xml2js from "xml2js";
import HttpError from "../../errors/httpError";

class Parser {
  request: HttpRequest | Http2Request;
  chunks: Buffer[];
  // Compteur de taille du corps (anti DoS RAM). `write` accumulait les chunks
  // SANS borne → un POST JSON/urlencoded/XML/brut de N Go bufferisait N Go en
  // RAM avant parse. On borne au `maxBodySize` (config http) : au dépassement on
  // libère les chunks, on coupe la lecture du socket et on rejette `parse()` en
  // 413. (Le multipart a son propre budget busboy — exclu de ce compteur.)
  private received: number = 0;
  private aborted: boolean = false;
  private overflow: HttpError | null = null;
  // Rejecter de la promesse `ended()` quand l'overflow survient PENDANT l'attente
  // (les chunks arrivent après l'appel à `parse()`). `null` hors attente.
  private onOverflow: ((err: HttpError) => void) | null = null;
  constructor(request: HttpRequest | Http2Request) {
    this.request = request;
    this.chunks = [];
    // Pas de `throw` dans le handler 'data' : un throw dans un callback
    // EventEmitter ne remonte PAS à l'appelant (→ uncaughtException). `write`
    // signale l'overflow par un drapeau, consommé par `ended()` / `parse()`.
    this.request.request.on("data", (data) => {
      this.write(data);
    });
  }

  write(buffer: Buffer): Buffer {
    if (this.aborted) {
      // Déjà au-dessus du seuil : on jette (RAM bornée) en attendant la coupure.
      return buffer;
    }
    const max = this.request.maxBodySize ?? 0;
    this.received += buffer.length;
    if (max > 0 && this.received > max) {
      this.aborted = true;
      // Libère immédiatement la RAM déjà bufferisée — c'est LA fuite qu'on tue.
      this.chunks.length = 0;
      this.overflow = new HttpError(
        `Request body exceeds maxBodySize (${max} bytes)`,
        413,
        this.request.context,
      );
      // Coupe la lecture du socket (le 413 pourra encore partir ; Node fermera la
      // connexion après la réponse puisque le corps n'est pas drainé).
      const req = this.request.request as { pause?: () => void };
      req.pause?.();
      if (this.onOverflow) {
        this.onOverflow(this.overflow);
      }
      return buffer;
    }
    this.chunks.push(buffer);
    return buffer;
  }

  /**
   * Résout quand le flux requête est **entièrement reçu** (`end`). No-op si déjà
   * terminé (corps vide / déjà drainé) → pas de hang d'un `once("end")` tardif.
   * Indispensable avant de concaténer les chunks pour un corps à décoder
   * (JSON…) : sinon on lit un buffer encore incomplet. (formidable drainait via
   * son `await form.parse()` ; ses remplaçants doivent drainer explicitement.)
   * Rejette en 413 si le corps dépasse `maxBodySize` (avant ou pendant l'attente).
   */
  protected ended(): Promise<void> {
    // Overflow déjà détecté avant l'attente (chunks arrivés avant `parse()`).
    if (this.overflow) {
      return Promise.reject(this.overflow);
    }
    const req = this.request.request as {
      readableEnded?: boolean;
      complete?: boolean;
      once(ev: string, cb: (...args: unknown[]) => void): unknown;
      removeListener(ev: string, cb: (...args: unknown[]) => void): unknown;
    };
    return new Promise((resolve, reject) => {
      if (req.readableEnded || req.complete) {
        return resolve();
      }
      // Listeners JUMEAUX (end/error) + rejecter d'overflow : `once` n'auto-
      // détache QUE celui qui fire → on retire les autres à la main (règle perf,
      // sinon 1 listener fantôme/requête jusqu'au GC).
      const cleanup = () => {
        req.removeListener("end", onEnd);
        req.removeListener("error", onError);
        this.onOverflow = null;
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = (e: unknown) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      // Overflow survenant PENDANT l'attente → rejette en 413.
      this.onOverflow = (err: HttpError) => {
        cleanup();
        reject(err);
      };
      req.once("end", onEnd);
      req.once("error", onError);
    });
  }

  async parse() {
    // DRAIN OBLIGATOIRE avant de concaténer : attendre `end` garantit que TOUS
    // les chunks sont arrivés (le listener `on("data")` du constructeur les
    // accumule). Sans ça, `Buffer.concat(this.chunks)` lisait un corps partiel/
    // vide (les Parser Qs/Xml/brut étaient invoqués sans attendre la fin du flux)
    // → `queryPost` vide pour urlencoded/xml. (ParserJson drainait déjà ; le
    // drain est désormais mutualisé ici pour tous les parsers.)
    await this.ended();
    this.request.data = Buffer.concat(this.chunks);
    // Corps reçu : signale la fin de réception (comme ParserQs/Xml/Json). Gate
    // le démarrage synchrone de session (Controller.startSession) — sans ça, un
    // corps passant par le Parser brut (ex: DELETE sans Content-Type) laissait
    // requestEnded=false → session en auto-start différé → getSession() null.
    this.request.context.requestEnded = true;
    return this;
  }
}

class ParserQs extends Parser {
  parserOptions: QS.IParseOptions;
  charset: BufferEncoding = "utf8";
  constructor(request: HttpRequest | Http2Request) {
    super(request);
    this.parserOptions = this.request.queryStringOptions || {};
    // Honore le charset détecté sur la requête (Content-Type charset=…) au lieu
    // d'un "utf8" hardcodé — sinon le corps latin1/etc. était mal décodé.
    this.charset = this.request.charset;
  }

  override async parse() {
    try {
      await super.parse();
      this.request.queryPost = QS.parse(
        this.request.data.toString(this.charset),
        this.parserOptions,
      );
      this.request.query = extend(
        {},
        this.request.query,
        this.request.queryPost,
      );
      this.request.context.requestEnded = true;
      return this;
    } catch (err) {
      throw err;
    }
  }
}

class ParserXml extends Parser {
  xmlParser: xml2js.Parser;
  charset: BufferEncoding = "utf8";
  constructor(
    request: HttpRequest | Http2Request,
    settingsXml?: xml2js.ParserOptions,
  ) {
    super(request);
    this.xmlParser = new xml2js.Parser(settingsXml);
    // Honore le charset de la requête (cf ParserQs) plutôt qu'un "utf8" figé.
    this.charset = this.request.charset;
  }

  override async parse(): Promise<any> {
    await super.parse();
    return new Promise((resolve, reject) => {
      this.xmlParser.parseString(
        this.request.data.toString(this.charset),
        (err, result) => {
          if (err) {
            return reject(err);
          }
          this.request.queryPost = result;
          this.request.context.requestEnded = true;
          return resolve(this);
        },
      );
    });
  }
}

/**
 * Parse un corps `application/json` (ou `*+json`) en objet → `queryPost`
 * (source lue par le décorateur `@Body`). Reprend le rôle de l'ancien plugin
 * `json` de formidable, supprimé avec le passage à busboy (multipart seul).
 * Lenient : un corps JSON malformé est ignoré (pas de throw — `parse()` est
 * invoqué non-awaité par `initialize`, un rejet serait non géré) ; le brut
 * reste disponible dans `request.data`.
 */
class ParserJson extends Parser {
  charset: BufferEncoding = "utf8";
  constructor(request: HttpRequest | Http2Request) {
    super(request);
    // Honore le charset de la requête (cf ParserQs/ParserXml).
    this.charset = this.request.charset;
  }

  override async parse() {
    await super.parse(); // base draine (ended()) puis concatène avant de parser
    const text = this.request.data.toString(this.charset).trim();
    if (text) {
      try {
        this.request.queryPost = JSON.parse(text) as Record<string, unknown>;
        this.request.query = extend(
          {},
          this.request.query,
          this.request.queryPost,
        );
      } catch {
        /* JSON malformé : ignoré (brut conservé dans request.data) */
      }
    }
    this.request.context.requestEnded = true;
    return this;
  }
}

// const acceptParser = function (
//   acc: string
// ): { type: RegExp; subtype: RegExp }[] {
//   if (!acc) {
//     return [
//       {
//         type: new RegExp(".*"),
//         subtype: new RegExp(".*"),
//       },
//     ];
//   }
//   const obj = {};
//   try {
//     const types = acc.split(",");
//     for (let i = 0; i < types.length; i++) {
//       const type = types[i].split(";");
//       const mine = type.shift();
//       if (!mine) {
//         throw new Error(`acceptParser error mine `);
//       }
//       const dec = mine.split("/");
//       const ele1 = dec.shift();
//       const ele2 = dec.shift();
//       obj[mine] = {
//         type: new RegExp(ele1 === "*" ? ".*" : ele1),
//         subtype: new RegExp(ele2 === "*" ? ".*" : ele2),
//       };
//       for (let j = 0; j < type.length; j++) {
//         const params = type[j].split("=");
//         const name = params.shift();
//         obj[mine][name] = params.shift();
//       }
//     }
//     // sort
//     const tab = [];
//     const qvalue = [];
//     for (const ele in obj) {
//       const line = obj[ele];
//       if (line.q) {
//         qvalue.push(obj[ele]);
//       } else {
//         tab.push(obj[ele]);
//       }
//     }
//     if (qvalue.length) {
//       return tab.concat(
//         qvalue.sort((a, b) => {
//           if (a.q > b.q) {
//             return -1;
//           }
//           if (a.q < b.q) {
//             return 1;
//           }
//           return 0;
//         })
//       );
//     }
//     return tab;
//   } catch (e) {
//     throw e;
//   }
// };

/** Media-range « accepte tout » (wildcard type + sous-type) — repli sûr, jamais throw. */
const ACCEPT_ANY: { type: RegExp; subtype: RegExp }[] = [
  { type: /.*/, subtype: /.*/ },
];

/**
 * Construit le matcher d'un composant de media-range `Accept` (`type` ou `subtype`).
 * Le wildcard `*` devient `.*` ; **tout autre token est ÉCHAPPÉ puis ancré** avant
 * `new RegExp` — jamais passé brut.
 *
 * ⚠️ Sécurité : le `Accept` est un en-tête CLIENT arbitraire. Le passer brut à
 * `new RegExp` (ancien code) faisait **throw** sur un métacaractère non balancé —
 * ex. un token à `*` en tête (`*x`) → `SyntaxError: Nothing to repeat` — throw NON
 * rattrapé remontant dans le constructeur de la requête = **crash / DoS trivial via
 * un simple en-tête**. L'échappement rend `new RegExp` infaillible ; l'ancrage
 * corrige aussi la négociation (match du token ENTIER, pas d'une sous-chaîne).
 */
const acceptMatcher = (token: string | undefined): RegExp =>
  !token || token === "*"
    ? /.*/
    : new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const acceptParser = function (
  acc?: string,
): { type: RegExp; subtype: RegExp; [key: string]: any }[] {
  if (!acc) {
    return [{ type: /.*/, subtype: /.*/ }];
  }
  const arr = [];
  try {
    const types = acc.split(",");
    for (let i = 0; i < types.length; i++) {
      const type = types[i].split(";");
      const mine = type.shift();
      if (!mine) {
        continue; // segment vide (ex. « , ,text/html ») → ignoré, jamais throw.
      }
      const dec = mine.trim().split("/");
      const ele1 = dec.shift();
      const ele2 = dec.shift();
      const obj: { [key: string]: any } = {
        type: acceptMatcher(ele1),
        subtype: acceptMatcher(ele2),
      };
      for (let j = 0; j < type.length; j++) {
        const params = type[j].split("=");
        const name = params.shift();
        const value = params.shift();
        obj[name as string] =
          name === "q" ? parseFloat(value as string) : value;
      }
      arr.push(obj);
    }
    if (arr.length === 0) {
      return ACCEPT_ANY;
    }
    // sort
    return arr.sort((a, b) => {
      const qA = a.q || 1;
      const qB = b.q || 1;
      return qB - qA;
    }) as { type: RegExp; subtype: RegExp; [key: string]: any }[];
  } catch {
    // Un `Accept` malformé ne doit JAMAIS faire échouer une requête (Zero Trust
    // sur l'entrée client) → repli « accepte tout » plutôt que de propager.
    return ACCEPT_ANY;
  }
};

export { Parser, ParserXml, ParserQs, ParserJson, acceptParser };
