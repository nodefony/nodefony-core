/// <reference types="node" />
/**
 * Fermeture d'un flux HTTP/2 dont la réponse est partie mais dont le client
 * émet encore (RFC 9113 §8.1 : `RST_STREAM` `NO_ERROR` APRÈS une réponse
 * complète). La coupe attend la grâce d'un aller-retour (`PING`) : coupé trop
 * tôt, nghttp2 jette les en-têtes encore en file et le client reçoit un
 * `RST_STREAM` sans statut — vécu au-delà de 10 refus simultanés sur une
 * session (plafond de `PING` en vol de Node), lu INTERNAL par un client gRPC
 * au lieu de son refus.
 *
 * Sockets réelles : c'est le client qui dit s'il a vu sa réponse.
 */
import { describe, it, expect, afterEach } from "vitest";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { closeStreamAfterGrace } from "../../src/servers/http2StreamGrace";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/**
 * Serveur qui refuse en 401 sans lire le corps, puis ferme après la grâce.
 * `closeSession` : la session entre en fermeture GRACIEUSE juste après la
 * réponse (délai d'inactivité, arrêt) — plus aucun `PING` possible, et elle
 * attend la fin des flux en cours.
 */
async function refusingServer(closeSession = false): Promise<number> {
  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("error", () => undefined);
    // Corps consommé, comme `closeUnfinishedRequest` (`request.resume()`) :
    // un flux dont le corps n'est PAS lu, Node le ferme seul — le test ne
    // prouverait alors rien.
    stream.resume();
    stream.respond({ ":status": 401 }, { endStream: true });
    if (closeSession) stream.session?.close();
    if (stream.writableFinished) closeStreamAfterGrace(stream);
    else stream.once("finish", () => closeStreamAfterGrace(stream));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  closers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return (server.address() as AddressInfo).port;
}

interface IOutcome {
  status: number;
  rstCode: number | undefined;
}

/** Au-delà, un flux encore ouvert compte comme « jamais fermé ». */
const CLOSE_CAP_MS = 3000;

/** `count` requêtes simultanées dont le client émet encore (corps jamais fini). */
async function emittingClients(
  port: number,
  count: number,
): Promise<IOutcome[]> {
  const session = http2.connect(`http://127.0.0.1:${port}`);
  session.on("error", () => undefined);
  closers.push(async () => {
    session.destroy();
  });
  await once(session, "connect");
  return Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<IOutcome>((resolve) => {
          const req = session.request({ ":method": "POST", ":path": "/" });
          let status = 0;
          req.on("response", (h) => (status = Number(h[":status"])));
          req.on("error", () => undefined);
          const cap = setTimeout(
            () => resolve({ status, rstCode: undefined }),
            CLOSE_CAP_MS,
          );
          req.on("close", () => {
            clearTimeout(cap);
            resolve({ status, rstCode: req.rstCode });
          });
          req.resume();
          req.write(Buffer.alloc(16));
        }),
    ),
  );
}

describe("closeStreamAfterGrace — RST_STREAM NO_ERROR après la réponse", () => {
  it("au-delà du plafond de PING de Node, chaque client reçoit sa réponse AVANT la coupe", async () => {
    const port = await refusingServer();
    const outcomes = await emittingClients(port, 32);
    const lost = outcomes.filter((o) => o.status !== 401).length;
    expect(lost, `${lost}/32 flux coupés sans réponse`).toBe(0);
  });

  it("un client qui émet encore est bien coupé, en NO_ERROR", async () => {
    const port = await refusingServer();
    const outcomes = await emittingClients(port, 32);
    for (const o of outcomes) {
      expect(o.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
    }
  });

  it("session en fermeture gracieuse (plus de PING) : le client muet reçoit sa réponse PUIS est coupé", async () => {
    const port = await refusingServer(true);
    const [o] = await emittingClients(port, 1);
    expect(o).toEqual({
      status: 401,
      rstCode: http2.constants.NGHTTP2_NO_ERROR,
    });
  });

  it("un seul client : réponse puis coupe (la grâce ne retient pas le flux)", async () => {
    const port = await refusingServer();
    const [o] = await emittingClients(port, 1);
    expect(o).toEqual({
      status: 401,
      rstCode: http2.constants.NGHTTP2_NO_ERROR,
    });
  });
});
