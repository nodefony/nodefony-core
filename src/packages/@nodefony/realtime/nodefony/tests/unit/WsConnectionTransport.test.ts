import { describe, it, expect } from "vitest";
import {
  WsConnectionTransport,
  BACKPRESSURE_DROP_BYTES,
  BACKPRESSURE_CLOSE_BYTES,
} from "../../src/transport/WsConnectionTransport.js";
import { TransportState } from "nodefony";

/** Mock d'une connexion `ws` brute (send/close/readyState). */
function mockConn(readyState: number = TransportState.OPEN) {
  const sent: string[] = [];
  let closed: { code?: number; reason?: string } | null = null;
  const conn = {
    readyState,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(data);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      closed = { code, reason };
    },
  };
  return { conn, sent, getClosed: () => closed };
}

describe("WsConnectionTransport — transport serveur (wrap connexion ws)", () => {
  it("send quand OPEN → délègue à conn.send", () => {
    const { conn, sent } = mockConn(TransportState.OPEN);
    new WsConnectionTransport(conn).send("hello");
    expect(sent).to.deep.equal(["hello"]);
  });

  it("send quand NON OPEN → drop (pas d'envoi sur socket pas prête)", () => {
    const { conn, sent } = mockConn(TransportState.CONNECTING);
    new WsConnectionTransport(conn).send("x");
    expect(sent).to.have.length(0);
  });

  it("close → délègue à conn.close avec code/reason", () => {
    const { conn, getClosed } = mockConn();
    new WsConnectionTransport(conn).close(1011, "bye");
    expect(getClosed()).to.deep.equal({ code: 1011, reason: "bye" });
  });

  it("readyState reflète la connexion", () => {
    const { conn } = mockConn(TransportState.CLOSED);
    expect(new WsConnectionTransport(conn).readyState).to.equal(
      TransportState.CLOSED,
    );
  });

  it("feed → le handler onMessage reçoit la frame brute", () => {
    const { conn } = mockConn();
    const t = new WsConnectionTransport(conn);
    const got: string[] = [];
    t.onMessage((raw) => got.push(raw));
    t.feed('{"a":1}');
    expect(got).to.deep.equal(['{"a":1}']);
  });

  it("fireClose → le handler onClose reçoit code/reason", () => {
    const { conn } = mockConn();
    const t = new WsConnectionTransport(conn);
    let closed: [number, string] | null = null;
    t.onClose((code, reason) => {
      closed = [code, reason];
    });
    t.fireClose(1006, "lost");
    expect(closed).to.deep.equal([1006, "lost"]);
  });

  it("connect()/onOpen/onError sont des no-op sûrs (cycle géré par le framework)", () => {
    const { conn } = mockConn();
    const t = new WsConnectionTransport(conn);
    expect(() => {
      t.connect();
      t.onOpen();
      t.onError();
    }).to.not.throw();
  });
});

/** Mock connexion `ws` avec `bufferedAmount` mutable (simule la back-pressure). */
function mockBpConn(
  bufferedAmount = 0,
  readyState: number = TransportState.OPEN,
) {
  const sent: string[] = [];
  let closed: { code?: number; reason?: string } | null = null;
  const conn = {
    readyState,
    bufferedAmount,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(data);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      closed = { code, reason };
    },
  };
  return { conn, sent, getClosed: () => closed };
}

describe("WsConnectionTransport — back-pressure (drop latest-wins / close 1013)", () => {
  it("sous le seuil DROP → envoi normal, dropped=0", () => {
    const { conn, sent } = mockBpConn(0);
    const t = new WsConnectionTransport(conn);
    t.send("hello");
    expect(sent).to.deep.equal(["hello"]);
    expect(t.bytesSent).to.equal(5);
    expect(t.dropped).to.equal(0);
  });

  it("≥ DROP (< CLOSE) → JETTE la frame (latest-wins), sans couper", () => {
    const { conn, sent, getClosed } = mockBpConn(BACKPRESSURE_DROP_BYTES);
    const t = new WsConnectionTransport(conn);
    t.send("dropme");
    expect(sent).to.have.length(0);
    expect(t.dropped).to.equal(1);
    expect(t.bytesSent).to.equal(0); // non comptée comme envoyée
    expect(getClosed()).to.equal(null); // la file peut redescendre → on ne coupe pas
  });

  it("≥ CLOSE → close(1013) slow-consumer + frame comptée droppée", () => {
    const { conn, sent, getClosed } = mockBpConn(BACKPRESSURE_CLOSE_BYTES);
    const t = new WsConnectionTransport(conn);
    t.send("toolate");
    expect(sent).to.have.length(0);
    expect(t.dropped).to.equal(1);
    expect(getClosed()).to.deep.equal({ code: 1013, reason: "slow consumer" });
  });

  it("connexion sans `bufferedAmount` (mock legacy) → jamais de drop", () => {
    const { conn, sent } = mockConn(TransportState.OPEN); // pas de bufferedAmount
    const t = new WsConnectionTransport(conn);
    t.send("a");
    t.send("b");
    expect(sent).to.deep.equal(["a", "b"]);
    expect(t.dropped).to.equal(0);
  });

  it("seuils surchargés par le constructeur (config realtime)", () => {
    const { conn, sent } = mockBpConn(100);
    const t = new WsConnectionTransport(conn, {
      dropBytes: 50,
      closeBytes: 200,
    });
    t.send("x"); // 100 ≥ 50 → drop, < 200 → pas de close
    expect(sent).to.have.length(0);
    expect(t.dropped).to.equal(1);
  });
});
