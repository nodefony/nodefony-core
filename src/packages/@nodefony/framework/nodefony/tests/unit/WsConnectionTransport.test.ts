import { expect } from "chai";
import "mocha";
import { WsConnectionTransport } from "../../src/WsConnectionTransport.js";
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
