/// <reference types="node" />
/**
 * HTTP/1.1 — une route que personne ne lira ne lit pas le corps (#695,
 * critère 51 ; ADR-0026, D5), sur le serveur RÉEL, en `node:net` brut pour voir
 * la connexion elle-même.
 *
 * Ce que ces cas tiennent :
 * - le 404 part AVANT que le corps soit envoyé — avant, il attendait le corps
 *   entier (ou le délai de réception, 30 s) ;
 * - corps déclaré ≤ 256 Kio : la connexion reste réutilisable — Node vide le
 *   corps une fois la réponse écrite, et une seconde requête y est servie ;
 * - corps déclaré > 256 Kio, ou de longueur inconnue (chunké) :
 *   `connection: close`, et le serveur ferme la connexion par étapes (RFC 9112
 *   §9.6) : un client qui écrit son corps EN ENTIER avant de lire reçoit la
 *   réponse, sans réinitialisation.
 */
import { describe, expect, it } from "vitest";
import net from "node:net";

const HOST = "localhost";
const PORT = 5151;
const UNROUTED = "/nodefony/test/unread-body-h1/unrouted";
/** Plafond d'attente : très en deçà du délai de réception (30 s). */
const CAP_MS = 10_000;

interface IHead {
  status: number;
  headers: Record<string, string>;
}

/** Lit les réponses HTTP/1.1 successives d'une socket, au fil de l'eau. */
class RawClient {
  readonly socket: net.Socket;
  #buffer = Buffer.alloc(0);
  #waiters: (() => void)[] = [];
  closed = false;
  /** Erreur de la socket (`EPIPE`, `ECONNRESET`) — `null` tant qu'il n'y en a pas. */
  error: Error | null = null;

  constructor() {
    this.socket = net.connect(PORT, HOST);
    this.socket.on("data", (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#wake();
    });
    this.socket.on("error", (error: Error) => {
      this.error = error;
    });
    this.socket.on("close", () => {
      this.closed = true;
      this.#wake();
    });
  }

  #wake(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const w of waiters) w();
  }

  #until(test: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const cap = setTimeout(() => resolve(false), CAP_MS);
      const check = (): void => {
        if (test()) {
          clearTimeout(cap);
          resolve(true);
        } else if (this.closed) {
          clearTimeout(cap);
          resolve(test());
        } else {
          this.#waiters.push(check);
        }
      };
      check();
    });
  }

  /** Attend une réponse complète (en-têtes + corps `content-length`), la consomme. */
  async response(): Promise<IHead | null> {
    let head: IHead | null = null;
    let total = 0;
    const ok = await this.#until(() => {
      const end = this.#buffer.indexOf("\r\n\r\n");
      if (end === -1) return false;
      const lines = this.#buffer
        .subarray(0, end)
        .toString("latin1")
        .split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const at = line.indexOf(":");
        headers[line.slice(0, at).trim().toLowerCase()] = line
          .slice(at + 1)
          .trim();
      }
      head = { status: Number(lines[0]?.split(" ")[1]), headers };
      total = end + 4 + Number(headers["content-length"] ?? 0);
      return this.#buffer.length >= total;
    });
    if (!ok) return null;
    this.#buffer = this.#buffer.subarray(total);
    return head;
  }

  /** Attend la fermeture de la connexion par le serveur. */
  closedByServer(): Promise<boolean> {
    return this.#until(() => this.closed);
  }

  dispose(): void {
    this.socket.destroy();
  }
}

function post(headers: string): string {
  return `POST ${UNROUTED} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n${headers}\r\n`;
}

describe("HTTP/1.1 — 404 sans lire le corps (#695, critère 51, requires server)", () => {
  it("corps déclaré ≤ 256 Kio : 404 AVANT l'envoi du corps, puis la connexion sert une seconde requête", async () => {
    const client = new RawClient();
    try {
      // En-têtes seuls : le corps annoncé n'est pas encore parti.
      client.socket.write(post("Content-Length: 1000\r\n"));
      const first = await client.response();
      expect(first?.status, "aucune réponse avant le corps").to.equal(404);
      expect(first?.headers.connection).to.not.equal("close");
      // Le corps arrive ensuite, puis une seconde requête sur la MÊME connexion.
      client.socket.write("x".repeat(1000));
      client.socket.write(
        `GET ${UNROUTED} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n\r\n`,
      );
      const second = await client.response();
      expect(second?.status, "connexion non réutilisée").to.equal(404);
    } finally {
      client.dispose();
    }
  }, 15_000);

  it("corps déclaré > 256 Kio : 404 avec `connection: close`, puis connexion fermée par le serveur", async () => {
    const client = new RawClient();
    try {
      client.socket.write(post(`Content-Length: ${1024 * 1024}\r\n`));
      client.socket.write("x".repeat(10));
      const head = await client.response();
      expect(head?.status, "aucune réponse avant le corps").to.equal(404);
      expect(head?.headers.connection).to.equal("close");
      expect(
        await client.closedByServer(),
        "connexion encore ouverte",
      ).to.equal(true);
    } finally {
      client.dispose();
    }
  }, 15_000);

  it("longueur inconnue (chunké, jamais fini) : 404 avec `connection: close`", async () => {
    const client = new RawClient();
    try {
      client.socket.write(post("Transfer-Encoding: chunked\r\n"));
      client.socket.write("a\r\n0123456789\r\n");
      const head = await client.response();
      expect(head?.status, "aucune réponse avant la fin du corps").to.equal(
        404,
      );
      expect(head?.headers.connection).to.equal("close");
      expect(
        await client.closedByServer(),
        "connexion encore ouverte",
      ).to.equal(true);
    } finally {
      client.dispose();
    }
  }, 15_000);

  it("corps de 1 Mio écrit EN ENTIER avant de lire : la réponse arrive, sans réinitialisation (fermeture attardée)", async () => {
    const client = new RawClient();
    try {
      // Le geste d'un client qui n'écoute qu'après avoir tout envoyé : sans
      // fermeture attardée, le serveur détruisait la socket sous ses écritures.
      client.socket.write(post(`Content-Length: ${1024 * 1024}\r\n`));
      client.socket.end("x".repeat(1024 * 1024));
      const head = await client.response();
      expect(client.error?.message ?? null, "réinitialisation").to.equal(null);
      expect(head?.status).to.equal(404);
      expect(head?.headers.connection).to.equal("close");
      expect(
        await client.closedByServer(),
        "connexion encore ouverte",
      ).to.equal(true);
    } finally {
      client.dispose();
    }
  }, 15_000);
});
