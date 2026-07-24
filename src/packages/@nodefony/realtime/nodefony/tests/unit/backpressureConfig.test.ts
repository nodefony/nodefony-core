import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  WsConnectionTransport,
  BACKPRESSURE_DROP_BYTES,
  BACKPRESSURE_CLOSE_BYTES,
  type RawWsConnection,
} from "../../src/transport/WsConnectionTransport.js";
import { defineRealtimeConfig } from "../../config/defineModuleConfig.js";

/** Connexion factice : `bufferedAmount` pilotable, envois et fermetures captés. */
function fakeConn(bufferedAmount: number): RawWsConnection & {
  sent: string[];
  closed: Array<{ code?: number }>;
} {
  const sent: string[] = [];
  const closed: Array<{ code?: number }> = [];
  return {
    readyState: 1,
    bufferedAmount,
    sent,
    closed,
    send(data: string) {
      sent.push(data);
    },
    close(code?: number) {
      closed.push({ code });
    },
  } as RawWsConnection & { sent: string[]; closed: Array<{ code?: number }> };
}

/**
 * Les seuils d'ACTION de la back-pressure sont réglables depuis la config. Sans
 * ce câblage ils n'étaient atteignables que par le 2ᵉ argument du constructeur
 * du transport, qu'aucun appelant de production ne passe.
 */
describe("back-pressure — les seuils de la config atteignent le transport", () => {
  it("le schéma expose les deux seuils, aux valeurs du transport", () => {
    const c = defineRealtimeConfig();
    expect(c.backpressure.dropBytes).to.equal(BACKPRESSURE_DROP_BYTES);
    expect(c.backpressure.closeBytes).to.equal(BACKPRESSURE_CLOSE_BYTES);
  });

  it("refuse un closeBytes qui n'est pas STRICTEMENT au-dessus du drop", () => {
    expect(() =>
      defineRealtimeConfig({
        backpressure: { dropBytes: 4096, closeBytes: 4096 },
      }),
    ).to.throw();
    expect(() =>
      defineRealtimeConfig({
        backpressure: { dropBytes: 8192, closeBytes: 4096 },
      }),
    ).to.throw();
    expect(() =>
      defineRealtimeConfig({
        backpressure: { dropBytes: 4096, closeBytes: 8192 },
      }),
    ).to.not.throw();
  });

  it("le hub ne porte AUCUN seuil tant que la config ne l'a pas posé", () => {
    expect(new RealtimeHub().backpressureBytes).to.equal(null);
  });

  it("le hub rend les seuils posés — ce que le contrôleur lit au handshake", () => {
    const hub = new RealtimeHub();
    const c = defineRealtimeConfig({
      backpressure: { dropBytes: 4096, closeBytes: 8192 },
    });
    hub.setBackpressureBytes(
      c.backpressure.dropBytes,
      c.backpressure.closeBytes,
    );
    expect(hub.backpressureBytes).to.deep.equal({
      dropBytes: 4096,
      closeBytes: 8192,
    });
  });

  it("un seuil ABAISSÉ fait vraiment jeter la frame (sinon on a déplacé le mensonge)", () => {
    const conn = fakeConn(5000); // au-dessus de 4096, très en dessous du 1 MiB par défaut
    const t = new WsConnectionTransport(conn, {
      dropBytes: 4096,
      closeBytes: 8192,
    });
    t.send("frame");
    expect(conn.sent).to.deep.equal([]); // jetée
    expect(t.dropped).to.equal(1);
    expect(conn.closed).to.deep.equal([]); // pas encore la fermeture
  });

  it("le même envoi PASSE avec les seuils par défaut — c'est bien le réglage qui agit", () => {
    const conn = fakeConn(5000);
    new WsConnectionTransport(conn).send("frame");
    expect(conn.sent).to.deep.equal(["frame"]);
  });

  it("au-delà du seuil de fermeture, la connexion est close en 1013", () => {
    const conn = fakeConn(9000);
    const t = new WsConnectionTransport(conn, {
      dropBytes: 4096,
      closeBytes: 8192,
    });
    t.send("frame");
    expect(conn.sent).to.deep.equal([]);
    expect(conn.closed.map((c) => c.code)).to.deep.equal([1013]);
  });
});
