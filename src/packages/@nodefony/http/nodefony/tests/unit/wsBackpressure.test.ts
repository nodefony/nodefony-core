/// <reference types="node" />
import { expect } from "chai";
import type Ws from "ws";
import type { WebSocketServer } from "ws";
import {
  decideSend,
  readBackpressureOptions,
  type IBackpressureSocket,
} from "../../src/context/websocket/wsBackpressure.js";

// G1 — backpressure SORTANTE (serveur → client). Vérifie la décision pure :
// désactivé / sous le seuil → "send" ; au-delà → "drop" (compteur) ou "close" (1013).

interface IStubSocket {
  bufferedAmount: number;
  _nfDrops?: number;
  closed?: { code: number; reason: string };
  close: (code: number, reason: string) => void;
}

const stub = (bufferedAmount: number): IStubSocket => {
  const s: IStubSocket = {
    bufferedAmount,
    close(code, reason) {
      s.closed = { code, reason };
    },
  };
  return s;
};

describe("wsBackpressure — décision d'émission (backpressure sortante)", () => {
  it("max <= 0 → désactivé : toujours 'send', même buffer énorme", () => {
    const s = stub(999_999_999);
    expect(decideSend(s as unknown as Ws, 0, "drop")).to.equal("send");
    expect(s._nfDrops).to.equal(undefined);
  });

  it("bufferedAmount <= seuil → 'send' (chemin nominal, 0 drop)", () => {
    const s = stub(1024);
    expect(decideSend(s as unknown as Ws, 4096, "drop")).to.equal("send");
    expect(s._nfDrops).to.equal(undefined);
  });

  it("au-delà du seuil, policy 'drop' → 'drop' + compteur, sans fermer", () => {
    const s = stub(8192);
    expect(decideSend(s as unknown as Ws, 4096, "drop")).to.equal("drop");
    expect(s._nfDrops).to.equal(1);
    expect(s.closed).to.equal(undefined);
    // 2e drop → compteur incrémenté
    expect(decideSend(s as unknown as Ws, 4096, "drop")).to.equal("drop");
    expect(s._nfDrops).to.equal(2);
  });

  it("au-delà du seuil, policy 'close' → 'close' + close(1013) + compteur", () => {
    const s = stub(8192);
    expect(decideSend(s as unknown as Ws, 4096, "close")).to.equal("close");
    expect(s._nfDrops).to.equal(1);
    expect(s.closed).to.deep.equal({ code: 1013, reason: "backpressure" });
  });

  it("readBackpressureOptions — défauts (wss null/sans options)", () => {
    expect(readBackpressureOptions(null)).to.deep.equal({
      max: 0,
      policy: "drop",
    });
    expect(
      readBackpressureOptions({ options: {} } as unknown as WebSocketServer),
    ).to.deep.equal({ max: 0, policy: "drop" });
  });

  it("readBackpressureOptions — lit les valeurs depuis wss.options", () => {
    const wss = {
      options: { maxBackpressure: 4096, backpressurePolicy: "close" },
    } as unknown as WebSocketServer;
    expect(readBackpressureOptions(wss)).to.deep.equal({
      max: 4096,
      policy: "close",
    });
  });

  it("le compteur _nfDrops est exposé pour la sonde socket", () => {
    const s = stub(8192) as unknown as IBackpressureSocket;
    decideSend(s as unknown as Ws, 1, "drop");
    expect(s._nfDrops).to.equal(1);
  });
});
