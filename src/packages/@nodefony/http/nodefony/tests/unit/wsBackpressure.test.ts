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
  _nfDropStreak?: number;
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
      closeAfterDrops: 0,
    });
    expect(
      readBackpressureOptions({ options: {} } as unknown as WebSocketServer),
    ).to.deep.equal({ max: 0, policy: "drop", closeAfterDrops: 0 });
  });

  it("readBackpressureOptions — lit les valeurs depuis wss.options", () => {
    const wss = {
      options: {
        maxBackpressure: 4096,
        backpressurePolicy: "close",
        backpressureCloseAfterDrops: 250,
      },
    } as unknown as WebSocketServer;
    expect(readBackpressureOptions(wss)).to.deep.equal({
      max: 4096,
      policy: "close",
      closeAfterDrops: 250,
    });
  });

  it("le compteur _nfDrops est exposé pour la sonde socket", () => {
    const s = stub(8192) as unknown as IBackpressureSocket;
    decideSend(s as unknown as Ws, 1, "drop");
    expect(s._nfDrops).to.equal(1);
  });
});

/**
 * Palier 2 — fermer une connexion qui ne draine PLUS.
 *
 * Pourquoi une SÉRIE de refus et pas un second seuil d'octets : une fois qu'on
 * jette, plus rien n'alimente la file, donc elle plafonne juste au-dessus du
 * seuil de drop et n'atteint JAMAIS un seuil supérieur. Mesuré sur socket
 * réelle (banc `ws-backpressure-e2e.mjs`) : 4000 frames poussées à un client qui
 * ne lit pas → 3 servies, 3997 jetées, **aucune fermeture**. Le client zombie
 * gardait sa connexion et son mégaoctet immobilisé indéfiniment.
 */
describe("wsBackpressure — palier 2 : fermeture sur série de refus", () => {
  it("closeAfterDrops = 0 → JAMAIS de fermeture, quel que soit le nombre de refus", () => {
    const s = stub(8192);
    for (let i = 0; i < 1000; i++) {
      expect(decideSend(s as unknown as Ws, 4096, "drop", 0)).to.equal("drop");
    }
    expect(s.closed).to.equal(undefined);
    expect(s._nfDrops).to.equal(1000);
  });

  it("ferme EXACTEMENT au N-ième refus consécutif, pas avant", () => {
    const s = stub(8192);
    for (let i = 1; i < 5; i++) {
      expect(decideSend(s as unknown as Ws, 4096, "drop", 5)).to.equal("drop");
      expect(s.closed, `refus ${i} ne doit pas fermer`).to.equal(undefined);
    }
    expect(decideSend(s as unknown as Ws, 4096, "drop", 5)).to.equal("close");
    expect(s.closed).to.deep.equal({ code: 1013, reason: "backpressure" });
  });

  it("le solde DÉCROÎT quand une frame passe — un pic n'est pas une agonie", () => {
    const s = stub(8192);
    decideSend(s as unknown as Ws, 4096, "drop", 5); // solde 1
    decideSend(s as unknown as Ws, 4096, "drop", 5); // solde 2
    expect(s._nfDropStreak).to.equal(2);
    s.bufferedAmount = 0; // le client draine
    decideSend(s as unknown as Ws, 4096, "drop", 5); // solde 1
    decideSend(s as unknown as Ws, 4096, "drop", 5); // solde 0
    expect(s._nfDropStreak).to.equal(0);
    expect(s.closed, "un client qui rattrape n'est jamais coupé").to.equal(
      undefined,
    );
  });

  it("⭐ un client qui refuse PLUS qu'il n'accepte finit par être fermé", () => {
    const s = stub(8192);
    // Deux refus pour un envoi : le solde monte de 1 à chaque cycle. C'est le
    // cas mesuré sur socket réelle, où la file oscille autour du seuil — une
    // remise à zéro l'aurait laissé connecté indéfiniment.
    for (let i = 0; i < 30 && !s.closed; i++) {
      s.bufferedAmount = 8192;
      decideSend(s as unknown as Ws, 4096, "drop", 5);
      decideSend(s as unknown as Ws, 4096, "drop", 5);
      s.bufferedAmount = 0;
      decideSend(s as unknown as Ws, 4096, "drop", 5);
    }
    expect(s.closed).to.deep.equal({ code: 1013, reason: "backpressure" });
  });

  it("le solde ne descend jamais SOUS zéro (pas de crédit accumulé)", () => {
    const s = stub(0);
    for (let i = 0; i < 50; i++)
      decideSend(s as unknown as Ws, 4096, "drop", 3);
    expect(s._nfDropStreak).to.equal(undefined);
    s.bufferedAmount = 8192;
    decideSend(s as unknown as Ws, 4096, "drop", 3);
    decideSend(s as unknown as Ws, 4096, "drop", 3);
    decideSend(s as unknown as Ws, 4096, "drop", 3);
    expect(
      s.closed,
      "3 refus suffisent, aucun crédit ne les a absorbés",
    ).to.deep.equal({ code: 1013, reason: "backpressure" });
  });

  it("le cumul _nfDrops n'est PAS remis à zéro par un drainage (métrique de sonde)", () => {
    const s = stub(8192);
    decideSend(s as unknown as Ws, 4096, "drop", 0);
    decideSend(s as unknown as Ws, 4096, "drop", 0);
    s.bufferedAmount = 0;
    decideSend(s as unknown as Ws, 4096, "drop", 0);
    expect(s._nfDrops).to.equal(2);
    expect(s._nfDropStreak).to.equal(1); // décroît de 1, ne repart pas de zéro
  });

  it("une socket SAINE n'écrit jamais le compteur de série (0 coût hot path)", () => {
    const s = stub(0);
    for (let i = 0; i < 100; i++)
      decideSend(s as unknown as Ws, 4096, "drop", 5);
    expect(s._nfDropStreak).to.equal(undefined);
    expect(s._nfDrops).to.equal(undefined);
  });

  it("policy 'close' garde la priorité : ferme au 1ᵉʳ dépassement", () => {
    const s = stub(8192);
    expect(decideSend(s as unknown as Ws, 4096, "close", 999)).to.equal(
      "close",
    );
    expect(s.closed).to.deep.equal({ code: 1013, reason: "backpressure" });
  });

  it("désactivé (max <= 0) : ni refus, ni série, ni fermeture", () => {
    const s = stub(999_999_999);
    for (let i = 0; i < 50; i++) decideSend(s as unknown as Ws, 0, "drop", 1);
    expect(s.closed).to.equal(undefined);
    expect(s._nfDrops).to.equal(undefined);
  });
});
