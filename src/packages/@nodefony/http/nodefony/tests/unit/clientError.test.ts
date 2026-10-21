/// <reference types="node" />
import { expect } from "vitest";
import type { Socket } from "node:net";
import http2 from "node:http2";
import net from "node:net";
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
