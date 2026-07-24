import { describe, it, expect } from "vitest";
import {
  WsConnectionTransport,
  type RawWsConnection,
} from "../../src/transport/WsConnectionTransport.js";

/** Connexion factice : `bufferedAmount` pilotable, envois et fermetures captés. */
type FakeConn = RawWsConnection & {
  sent: string[];
  closed: Array<{ code?: number }>;
  bufferedAmount: number;
  readyState: number;
};

function fakeConn(bufferedAmount: number): FakeConn {
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
  } as FakeConn;
}

/**
 * Le transport realtime n'implémente PAS sa propre contre-pression : il applique
 * celle de `@nodefony/http` (`decideSend`), avec les réglages du serveur WebSocket
 * qui sert la connexion. Deux implémentations de la même protection avaient déjà
 * divergé en silence (4 MiB d'un côté, 1 MiB de l'autre).
 */
describe("WsConnectionTransport — applique la contre-pression de @nodefony/http", () => {
  it("sans réglage, la protection est INACTIVE (serveur non configuré)", () => {
    const conn = fakeConn(999_999_999);
    new WsConnectionTransport(conn).send("frame");
    expect(conn.sent).to.deep.equal(["frame"]);
  });

  it("sous le seuil → la frame part", () => {
    const conn = fakeConn(1024);
    new WsConnectionTransport(conn, { max: 4096 }).send("frame");
    expect(conn.sent).to.deep.equal(["frame"]);
  });

  it("au-dessus du seuil → la frame est JETÉE et comptée", () => {
    const conn = fakeConn(8192);
    const t = new WsConnectionTransport(conn, { max: 4096 });
    t.send("frame");
    expect(conn.sent).to.deep.equal([]);
    expect(t.dropped).to.equal(1);
    expect(conn.closed).to.deep.equal([]);
  });

  it("policy 'close' → ferme en 1013 dès le premier dépassement", () => {
    const conn = fakeConn(8192);
    new WsConnectionTransport(conn, { max: 4096, policy: "close" }).send("f");
    expect(conn.closed.map((c) => c.code)).to.deep.equal([1013]);
  });

  it("⭐ ferme après N refus CONSÉCUTIFS — le seuil d'octets seul ne suffit pas", () => {
    const conn = fakeConn(8192);
    const t = new WsConnectionTransport(conn, {
      max: 4096,
      closeAfterDrops: 3,
    });
    t.send("a");
    t.send("b");
    expect(conn.closed, "pas encore : 2 refus").to.deep.equal([]);
    t.send("c");
    expect(conn.closed.map((c) => c.code)).to.deep.equal([1013]);
    expect(t.dropped).to.equal(3);
  });

  it("le solde DÉCROÎT quand une frame passe (pic passager ≠ client mort)", () => {
    const conn = fakeConn(8192);
    const t = new WsConnectionTransport(conn, {
      max: 4096,
      closeAfterDrops: 4,
    });
    t.send("a"); // solde 1
    t.send("b"); // solde 2
    conn.bufferedAmount = 0; // le client rattrape
    t.send("c"); // solde 1, envoyée
    t.send("d"); // solde 0, envoyée
    expect(conn.sent).to.deep.equal(["c", "d"]);
    conn.bufferedAmount = 8192; // il ressature
    t.send("e"); // solde 1
    t.send("f"); // solde 2
    expect(conn.closed, "un client qui rattrape n'est pas coupé").to.deep.equal(
      [],
    );
  });

  it("⭐ un client qui refuse PLUS qu'il n'accepte finit coupé (file qui OSCILLE)", () => {
    // Cas mesuré sur socket réelle : la file oscille autour du seuil, donc une
    // remise à zéro du compteur empêchait TOUTE fermeture.
    const conn = fakeConn(8192);
    const t = new WsConnectionTransport(conn, {
      max: 4096,
      closeAfterDrops: 4,
    });
    for (let i = 0; i < 20 && conn.closed.length === 0; i++) {
      conn.bufferedAmount = 8192;
      t.send("x");
      t.send("y");
      conn.bufferedAmount = 0;
      t.send("z");
    }
    expect(conn.closed.map((c) => c.code)).to.deep.equal([1013]);
  });

  it("socket fermée → aucun envoi, aucune décision", () => {
    const conn = fakeConn(0);
    conn.readyState = 3;
    const t = new WsConnectionTransport(conn, { max: 4096 });
    t.send("frame");
    expect(conn.sent).to.deep.equal([]);
    expect(t.dropped).to.equal(0);
  });
});
