/// <reference types="node" />
import { expect } from "chai";
import type { Socket } from "node:net";
import { handleClientError } from "../../service/servers/clientError.js";

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
