/// <reference types="node" />
/**
 * Le délai d'inactivité des sessions HTTP/2 est désarmé quand le client ferme.
 *
 * Node (24, 26) ne le désarme pas lui-même : `closeSession` marque la session
 * détruite avant d'appeler `setTimeout(0)`, qui sort alors sans rien faire. Le
 * minuteur garde la session fermée en vie jusqu'à son échéance (~2,4 Ko par
 * session, vu au gate mémoire). `session.timeout` le rend observable :
 * `setTimeout(0)` effectif le remet à 0, l'appel avorté le laisse au délai.
 *
 * Le témoin sans contournement fige le défaut de Node (nodejs/node#66885) : le
 * jour où il rougit, Node est corrigé et `setHttp2SessionTimeout` peut
 * redevenir un simple `server.setTimeout`.
 */
import { expect } from "vitest";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { setHttp2SessionTimeout } from "../../src/servers/http2Limits";

const TIMEOUT = 30_000;

/** `timeout` existe à l'exécution sur la session et le serveur HTTP/2, pas dans leurs types. */
const timeoutOf = (target: object): unknown => Reflect.get(target, "timeout");

/** Une requête, fermeture par le client, puis la session serveur une fois fermée. */
async function closedServerSession(
  arm: (server: http2.Http2Server) => void,
  close: (client: http2.ClientHttp2Session) => void,
): Promise<http2.ServerHttp2Session> {
  const server = http2.createServer();
  arm(server);
  server.on("request", (_req, res) => res.end("ok"));
  const seen = new Promise<http2.ServerHttp2Session>((resolve) =>
    server.once("session", (s) => s.once("close", () => resolve(s))),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const client = http2.connect(`http://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    const stream = client.request({ ":path": "/" });
    stream.on("error", reject);
    stream.on("end", () => resolve());
    stream.resume();
    stream.end();
  });
  close(client);
  const session = await seen;
  await new Promise<void>((r) => server.close(() => r()));
  return session;
}

describe("setHttp2SessionTimeout — le minuteur ne survit pas à la session", () => {
  it("témoin : server.setTimeout seul laisse le minuteur armé (défaut de Node)", async () => {
    const session = await closedServerSession(
      (server) => server.setTimeout(TIMEOUT, () => {}),
      (client) => client.close(),
    );
    expect(session.destroyed).to.equal(true);
    expect(timeoutOf(session), "Node n'a pas désarmé").to.equal(TIMEOUT);
  });

  for (const [name, close] of [
    ["client.close()", (c: http2.ClientHttp2Session) => c.close()],
    ["client.destroy()", (c: http2.ClientHttp2Session) => c.destroy()],
  ] as const) {
    it(`${name} : GOAWAY reçu, minuteur désarmé avant la destruction`, async () => {
      const session = await closedServerSession(
        (server) => setHttp2SessionTimeout(server, TIMEOUT, () => {}),
        close,
      );
      expect(session.destroyed).to.equal(true);
      expect(timeoutOf(session)).to.equal(0);
    });
  }

  it("délai 0 ou absent : rien n'est armé, aucun écouteur posé", () => {
    const server = http2.createServer();
    setHttp2SessionTimeout(server, 0, () => {});
    setHttp2SessionTimeout(server, undefined, () => {});
    expect(timeoutOf(server)).to.equal(0);
    expect(server.listenerCount("session")).to.equal(0);
  });
});
