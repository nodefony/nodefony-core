import Cookie from "../../cookies/cookie.js";
import { Message, Msgid, Pci, Severity, Syslog } from "nodefony";
import WebsocketContext from "./WebsocketContext.js";
import Ws, { WebSocketServer } from "ws";
import http from "node:http";
import {
  decideSend,
  readBackpressureOptions,
  type IBackpressureSocket,
  type WsSendDecision,
} from "./wsBackpressure.js";

export interface IWsCookie {
  name: string;
  value: string;
  maxage?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httponly?: boolean;
  secure?: boolean;
}

/**
 * Codes d'erreur d'écriture « le client est PARTI » : reload de page, onglet
 * fermé, HMR — la socket TCP est morte côté client pendant qu'une frame était
 * en vol. Race réseau INÉVITABLE (la garde `readyState === OPEN` ne la couvre
 * pas : l'état bascule après l'échec d'écriture) — c'est du réseau normal, pas
 * une erreur serveur.
 */
const PEER_GONE_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

/**
 * `true` si l'erreur d'écriture signifie seulement que le client s'est
 * déconnecté (frame perdue, connexion en cours de fermeture) — à logger DEBUG,
 * jamais ERROR + stack (vécu : un simple reload de page pendant un ping WS
 * remplissait le journal d'« Error: write EPIPE »).
 */
export function isPeerGoneError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && PEER_GONE_CODES.has(code);
}

const WS_CLOSE_DESCRIPTIONS: Record<number, string> = {
  1000: "Normal Closure",
  1001: "Going Away",
  1002: "Protocol Error",
  1003: "Unsupported Data",
  1005: "No Status Received",
  1006: "Abnormal Closure",
  1007: "Invalid frame payload data",
  1008: "Policy Violation",
  1009: "Message too big",
  1010: "Missing Extension",
  1011: "Internal Error",
  1012: "Service Restart",
  1013: "Try Again Later",
  1015: "TLS Handshake",
};

class WebsocketResponse {
  statusCode: number = 1000;
  body: Buffer | null = null;
  encoding: BufferEncoding = "utf-8";
  connection: Ws | null = null;
  statusMessage: string = "";
  webSocketVersion?: number;
  cookies: Record<string, Cookie> = {};

  constructor(
    connection: Ws | null,
    private context: WebsocketContext,
  ) {
    this.connection = connection;
  }

  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) {
    const syslog: Syslog | null | undefined =
      this.context?.container?.get<Syslog>("syslog");
    if (!msgid) {
      msgid = "WEBSOCKET RESPONSE";
    }
    return syslog?.log(pci, severity, msgid, msg);
  }

  setConnection(connection: Ws) {
    this.connection = connection;
    return connection;
  }

  async send(
    data?: Buffer | string | null,
    encoding?: BufferEncoding,
  ): Promise<WebsocketResponse> {
    const payload = data ?? this.body;
    // `== null` (pas falsy) : une frame texte VIDE est légale (RFC 6455 §5.6) —
    // un handler qui `return ""` ne doit pas throw « no data ».
    if (payload == null) throw new Error("no data");

    return new Promise((resolve, reject) => {
      if (!this.connection || this.connection.readyState !== Ws.OPEN) {
        return reject(new Error("WebSocket not open"));
      }
      // Backpressure SORTANTE (G1) : si le client est lent à recevoir, on ne gonfle
      // pas la RAM d'envoi sans borne. Sous le seuil = chemin nominal (0 alloc).
      const { max, policy } = readBackpressureOptions(
        this.context?.server as WebSocketServer | null,
      );
      const decision = decideSend(this.connection, max, policy);
      if (decision !== "send") {
        this.logFirstDrop(this.connection, decision, max);
        // Frame non émise (drop) ou socket fermée (close) — pas une erreur.
        return resolve(this);
      }
      // ws.send handles both text and binary transparently
      const sendData =
        encoding === "binary" && Buffer.isBuffer(payload)
          ? payload
          : payload instanceof Buffer
            ? payload.toString(encoding ?? this.encoding)
            : payload;

      this.connection.send(sendData, (error) => {
        if (error) {
          // Client parti pendant l'écriture → même sémantique que decideSend
          // "close" (l.90) : frame perdue, PAS une erreur — résolu sans bruit.
          // Rejeter forcerait chaque handler à try/catch un simple reload.
          if (isPeerGoneError(error)) {
            this.log(
              `WS send: client déconnecté pendant l'écriture (${(error as NodeJS.ErrnoException).code}) — frame perdue`,
              "DEBUG",
            );
            return resolve(this);
          }
          this.log(error, "ERROR");
          return reject(error);
        }
        return resolve(this);
      });
    });
  }

  broadcast(data?: Buffer | string | null, type?: BufferEncoding): void {
    const payload = data ?? this.body;
    if (!payload) return;

    const wss = this.context?.server as WebSocketServer | null;
    if (!wss) return;

    // R4 — parité avec send() : en binaire le Buffer part TEL QUEL (un
    // `.toString()` forcé corromprait les octets non-UTF-8 et changerait
    // l'opcode de frame RFC 6455 §5.6 binary → text).
    const sendData =
      type === "binary" && Buffer.isBuffer(payload)
        ? payload
        : payload instanceof Buffer
          ? payload.toString(this.encoding)
          : payload;

    // Seuil + politique lus UNE fois hors boucle (pas par client).
    const { max, policy } = readBackpressureOptions(wss);
    // UNE closure par broadcast (pas par client — règle perf : N clients ×
    // M frames). Client parti = silencieux ; vraie erreur d'écriture = ERROR.
    const onWriteError = (error?: Error) => {
      if (error && !isPeerGoneError(error)) {
        this.log(error, "ERROR");
      }
    };
    wss.clients.forEach((client) => {
      if (client.readyState !== Ws.OPEN) {
        return;
      }
      // Backpressure SORTANTE (G1) : un client lent ne doit pas plomber la
      // diffusion ni gonfler la RAM serveur → on le saute (drop) / ferme (close).
      const decision = decideSend(client, max, policy);
      if (decision !== "send") {
        this.logFirstDrop(client, decision, max);
        return;
      }
      // Callback OBLIGATOIRE : sans lui, une erreur d'écriture async (client
      // parti mi-broadcast) est émise en event "error" du socket au lieu
      // d'être absorbée ici.
      client.send(sendData, onWriteError);
    });
  }

  /**
   * Logge UNE seule fois par connexion (au 1er drop) qu'un client subit la
   * backpressure — observabilité opérateur sans bruit dans le hot path.
   */
  private logFirstDrop(ws: Ws, decision: WsSendDecision, max: number): void {
    if ((ws as IBackpressureSocket)._nfDrops === 1) {
      this.log(
        `WS backpressure → ${decision} (bufferedAmount > ${max} o) — client lent à recevoir`,
        "WARNING",
      );
    }
  }

  setBody(
    ele: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    encoding?: BufferEncoding,
  ) {
    if (typeof ele === "string") {
      this.body = Buffer.from(ele, encoding ?? this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if ("buffer" in ele && ele.buffer instanceof ArrayBuffer) {
      this.body = Buffer.from(ele.buffer);
    }
    return this.body;
  }

  drop(reasonCode: number, description: string) {
    if (this.connection && this.connection.readyState === Ws.OPEN) {
      return this.connection.close(reasonCode ?? this.statusCode, description);
    }
    throw new Error("Connection already closed");
  }

  close(reasonCode: number, description: string) {
    if (this.connection && this.connection.readyState === Ws.OPEN) {
      return this.connection.close(
        reasonCode ?? this.statusCode,
        description ?? "closed",
      );
    }
    throw new Error("Connection already closed");
  }

  getStatus() {
    return {
      code: this.getStatusCode(),
      message: this.getStatusMessage(),
    };
  }

  getStatusCode() {
    return this.statusCode;
  }

  getStatusMessage() {
    return this.statusMessage;
  }

  setStatusCode(status: number | string, message?: string) {
    if (typeof status !== "number") {
      status = parseInt(status as string, 10);
      if (isNaN(status)) status = 500;
    }
    if (!status) status = 500;
    this.statusCode = status;
    if (!message) {
      message =
        WS_CLOSE_DESCRIPTIONS[this.statusCode] ??
        http.STATUS_CODES[this.statusCode];
    }
    this.statusMessage = message ?? "";
    return { code: this.statusCode, message: this.statusMessage };
  }

  clean() {
    this.connection = null;
    this.body = null;
  }

  setEncoding(encoding: BufferEncoding) {
    return (this.encoding = encoding);
  }

  setHeader(/* name, value*/) {
    return true;
  }

  setHeaders(/* obj*/) {
    return true;
  }

  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      this.cookies[cookie.name] = cookie;
    } else {
      throw new Error("Response addCookies not valid cookies");
    }
  }

  // WS handshake response cookies are not supported by ws library —
  // session cookies are set during the HTTP phase before upgrade.
  setCookies() {
    // no-op for ws: cookies cannot be set in WebSocket handshake response
  }

  setCookie(_cookie: Cookie) {
    // no-op for ws
  }
}

export default WebsocketResponse;
