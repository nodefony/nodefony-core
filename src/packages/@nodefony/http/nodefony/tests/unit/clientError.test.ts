/// <reference types="node" />
import { expect } from "vitest";
import type { Socket } from "node:net";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
import type { AddressInfo } from "node:net";
import {
  handleClientError,
  handleSessionError,
} from "../../service/servers/clientError.js";

// Stub minimal d'un socket : capture l'argument passé à end() + writable.
function makeSocket(writable = true): {
  socket: Socket;
  ended: string[];
} {
  const ended: string[] = [];
  const socket = {
    writable,
    end(data?: string) {
      if (data) {
        ended.push(data);
      }
      return this;
    },
  } as unknown as Socket;
  return { socket, ended };
}

// handleClientError : un listener clientError désactive la fermeture auto de
// Node → on DOIT répondre + fermer (sinon fuite de socket/FD = DoS).
describe("handleClientError — fermeture du socket malformé", () => {
  it("erreur générique → répond 400 Bad Request et ferme", () => {
    const { socket, ended } = makeSocket();
    handleClientError(
      { code: "HPE_INVALID_METHOD" } as NodeJS.ErrnoException,
      socket,
    );
    expect(ended).to.have.length(1);
    expect(ended[0]).to.include("400 Bad Request");
    expect(ended[0]).to.include("Connection: close");
  });

  it("HPE_HEADER_OVERFLOW → répond 431", () => {
    const { socket, ended } = makeSocket();
    handleClientError(
      { code: "HPE_HEADER_OVERFLOW" } as NodeJS.ErrnoException,
      socket,
    );
    expect(ended[0]).to.include("431 Request Header Fields Too Large");
  });

  // La table de Node (`_http_server.js#socketOnError`) : un écouteur
  // `clientError` la retire, elle doit donc être rendue à l'identique.
  for (const [code, status] of [
    ["ERR_HTTP_REQUEST_TIMEOUT", "408 Request Timeout"],
    ["HPE_CHUNK_EXTENSIONS_OVERFLOW", "413 Payload Too Large"],
  ] as const) {
    it(`${code} → répond ${status}, comme Node sans écouteur`, () => {
      const { socket, ended } = makeSocket();
      handleClientError(Object.assign(new Error(code), { code }), socket);
      expect(ended[0]).to.match(new RegExp(`^HTTP/1\\.1 ${status}\\r\\n`));
    });
  }

  // Une réponse EN VOL dont les en-têtes sont partis (une 404 rendue avant la
  // fin d'un corps qui n'arrive jamais) : écrire une ligne de statut après
  // elle corromprait le flux du client — Node se tait et détruit.
  function inFlightSocket(headerSent: boolean): {
    socket: Duplex;
    written: string[];
    destroyed: () => boolean;
  } {
    const written: string[] = [];
    let destroyed = false;
    const socket = Object.assign(
      new Duplex({
        read() {},
        write(chunk: Buffer, _enc, done) {
          written.push(chunk.toString("latin1"));
          done();
        },
      }),
      { _httpMessage: { _headerSent: headerSent } },
    );
    socket.on("close", () => (destroyed = true));
    return { socket, written, destroyed: () => destroyed };
  }

  it("réponse en vol déjà partie → RIEN n'est écrit, la socket est détruite", async () => {
    const { socket, written, destroyed } = inFlightSocket(true);
    const timeout = Object.assign(new Error("timeout"), {
      code: "ERR_HTTP_REQUEST_TIMEOUT",
    });
    handleClientError(timeout, socket);
    await new Promise((resolve) => setImmediate(resolve));
    expect(written).to.deep.equal([]);
    expect(destroyed()).to.equal(true);
  });

  it("réponse en vol pas encore partie → le 408 est écrit", async () => {
    const { socket, written } = inFlightSocket(false);
    const timeout = Object.assign(new Error("timeout"), {
      code: "ERR_HTTP_REQUEST_TIMEOUT",
    });
    handleClientError(timeout, socket);
    await new Promise((resolve) => setImmediate(resolve));
    expect(written.join("")).to.match(/^HTTP\/1\.1 408 Request Timeout\r\n/);
  });

  it("refus délimité : Content-Length: 0 (RFC 9112 §6.3)", () => {
    const { socket, ended } = makeSocket();
    handleClientError(new Error("bad") as NodeJS.ErrnoException, socket);
    expect(ended[0]).to.include("Content-Length: 0\r\n");
  });

  it("ECONNRESET → ne tente RIEN (socket déjà mort)", () => {
    const { socket, ended } = makeSocket();
    handleClientError({ code: "ECONNRESET" } as NodeJS.ErrnoException, socket);
    expect(ended).to.have.length(0);
  });

  it("socket non writable → ne tente RIEN", () => {
    const { socket, ended } = makeSocket(false);
    handleClientError(
      { code: "HPE_INVALID_HEADER_TOKEN" } as NodeJS.ErrnoException,
      socket,
    );
    expect(ended).to.have.length(0);
  });
});

/**
 * RFC 9112 §3 : une cible plus longue que ce que le serveur veut lire → 414.
 * Node lève le même `HPE_HEADER_OVERFLOW` pour une URL et pour des en-têtes
 * trop longs ; le test passe par un vrai serveur et de vrais paquets, en un
 * envoi et en plusieurs, parce que la distinction se lit sur le paquet reçu.
 */
describe("handleClientError — 414 pour la cible, 431 pour les en-têtes", () => {
  async function statusFor(request: string, chunks: number): Promise<string> {
    const { createServer } = await import("node:http");
    const server = createServer((_q, s) => s.end("ok"));
    server.on("clientError", handleClientError);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;
    try {
      return await new Promise<string>((resolve, reject) => {
        let reply = "";
        const size = Math.ceil(request.length / chunks);
        // Un paquet toutes les 10 ms : le serveur les lit un à un.
        const sendFrom = (at: number): void => {
          if (at >= request.length || client.destroyed) return;
          client.write(request.slice(at, at + size));
          setTimeout(() => sendFrom(at + size), 10);
        };
        const client = net.connect(port, "127.0.0.1", () => sendFrom(0));
        client.setEncoding("latin1");
        client.on("data", (d: string) => (reply += d));
        client.on("close", () => resolve(reply));
        client.on("error", reject);
      });
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  }

  const longTarget = `GET /${"a".repeat(20_000)} HTTP/1.1\r\nHost: x\r\n\r\n`;
  const longHeader = `GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${"b".repeat(20_000)}\r\n\r\n`;

  for (const chunks of [1, 5]) {
    it(`cible trop longue (${chunks} paquet(s)) → 414`, async () => {
      const reply = await statusFor(longTarget, chunks);
      expect(reply).to.match(/^HTTP\/1\.1 414 URI Too Long\r\n/);
      expect(reply).to.include("Content-Length: 0\r\n");
    });

    it(`en-tête trop long (${chunks} paquet(s)) → 431`, async () => {
      const reply = await statusFor(longHeader, chunks);
      expect(reply).to.match(/^HTTP\/1\.1 431 /);
    });
  }
});

// handleSessionError : une sonde de port (status, doctor, superviseur, sonde
// tcpSocket d'un orchestrateur) faisait imprimer une pile ECONNRESET au serveur
// HTTP/2 — en DEBUG sur h2c, en ERROR sur TLS.
describe("handleSessionError — un pair parti se tait", () => {
  const errno = (code: string): Error =>
    Object.assign(new Error(code), { code });

  it("ECONNRESET / EPIPE → rien n'est rapporté", () => {
    const reported: Error[] = [];
    handleSessionError(errno("ECONNRESET"), (e) => reported.push(e));
    handleSessionError(errno("EPIPE"), (e) => reported.push(e));
    expect(reported).toHaveLength(0);
  });

  it("toute autre erreur de session → rapportée telle quelle", () => {
    const reported: Error[] = [];
    const preface = errno("ERR_HTTP2_ERROR");
    handleSessionError(preface, (e) => reported.push(e));
    expect(reported).toEqual([preface]);
  });

  it("la sonde réelle : connexion fermée sans lire le SETTINGS → ECONNRESET, tu", async () => {
    const server = http2.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const sessionError = new Promise<Error>((resolve) =>
      server.once("sessionError", resolve),
    );
    try {
      // Comme `isPortListening` : se connecter, ne rien lire, détruire. Le
      // SETTINGS du serveur reste non lu dans le tampon → le système ferme
      // par un RST.
      const probe = net.connect({ host: "127.0.0.1", port });
      probe.pause();
      await new Promise<void>((resolve) => probe.once("connect", resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
      probe.destroy();
      const error = await sessionError;
      expect((error as NodeJS.ErrnoException).code).toBe("ECONNRESET");
      const reported: Error[] = [];
      handleSessionError(error, (e) => reported.push(e));
      expect(reported).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
