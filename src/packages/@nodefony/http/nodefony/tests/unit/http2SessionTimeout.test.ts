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
import tls from "node:tls";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Socket, type AddressInfo } from "node:net";
import { setHttp2SessionTimeout } from "../../src/servers/http2Limits";
import { createSelfSignedCertificate } from "../../service/x509";

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

/** Délai court : seule l'ÉCHÉANCE compte, jamais une durée assertée. */
const IDLE = 100;

/** Un serveur h2c à l'écoute, et un client connecté. */
async function connectedPair(
  arm: (server: http2.Http2Server) => void,
  onStream?: (stream: http2.ServerHttp2Stream) => void,
): Promise<{ server: http2.Http2Server; client: http2.ClientHttp2Session }> {
  const server = http2.createServer();
  arm(server);
  if (onStream) server.on("stream", onStream);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const client = http2.connect(`http://127.0.0.1:${port}`);
  await new Promise<void>((r) => client.once("connect", () => r()));
  return { server, client };
}

/** Ferme tout, sans attendre le client (il peut déjà être fermé). */
async function teardown(
  server: http2.Http2Server,
  client: http2.ClientHttp2Session,
): Promise<void> {
  client.destroy();
  await new Promise<void>((r) => server.close(() => r()));
}

describe("setHttp2SessionTimeout — une session inactive est FERMÉE (#763)", () => {
  it("témoin : un écouteur `timeout` qui ne ferme rien laisse la session vivre (Node)", async () => {
    let fired!: () => void;
    const timedOut = new Promise<void>((r) => (fired = r));
    const { server, client } = await connectedPair((s) =>
      s.setTimeout(IDLE, () => fired()),
    );
    let goaway = false;
    client.on("goaway", () => (goaway = true));
    await timedOut;
    // Témoin de vie APRÈS l'échéance : un PING fait l'aller-retour.
    await new Promise<void>((resolve, reject) =>
      client.ping((err) => (err ? reject(err) : resolve())),
    );
    expect(goaway, "Node n'a rien envoyé").to.equal(false);
    expect(client.closed).to.equal(false);
    await teardown(server, client);
  });

  it("session vide : GOAWAY annoncé à 2^31-1 (RFC 9113 §6.8), puis fermée", async () => {
    let calls = 0;
    const { server, client } = await connectedPair((s) =>
      setHttp2SessionTimeout(s, IDLE, () => calls++),
    );
    const goaways: Array<[number, number]> = [];
    client.on("goaway", (code: number, last: number) =>
      goaways.push([code, last]),
    );
    await new Promise<void>((r) => client.once("close", () => r()));
    expect(goaways.length).to.be.greaterThan(0);
    expect(goaways[0], "annonce : aucun flux écarté").to.deep.equal([
      http2.constants.NGHTTP2_NO_ERROR,
      2 ** 31 - 1,
    ]);
    for (const [code] of goaways) {
      expect(code).to.equal(http2.constants.NGHTTP2_NO_ERROR);
    }
    expect(calls, "l'application est prévenue").to.equal(1);
    await teardown(server, client);
  });

  it("flux ouvert et muet : il reçoit le GOAWAY et va à son terme", async () => {
    const { server, client } = await connectedPair(
      (s) => setHttp2SessionTimeout(s, IDLE, () => {}),
      (stream) => {
        stream.respond({ ":status": 200 });
        // Muet jusqu'à ce que le client parle de nouveau, APRÈS le GOAWAY.
        stream.on("data", () => stream.end("pong"));
      },
    );
    const request = client.request({ ":method": "POST", ":path": "/" });
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk: string) => (body += chunk));
    await new Promise<void>((r) => client.once("goaway", () => r()));
    request.end("ping");
    await new Promise<void>((resolve, reject) => {
      request.on("end", () => resolve());
      request.on("error", reject);
    });
    expect(body, "le flux a survécu au GOAWAY").to.equal("pong");
    await new Promise<void>((r) =>
      client.closed ? r() : client.once("close", () => r()),
    );
    await teardown(server, client);
  });
});

describe("setHttp2SessionTimeout — 5152 (`allowHTTP1`)", () => {
  it("une socket HTTP/1.1 inactive est laissée à `routeSocketTimeout` : ni erreur, ni avis", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const cert = await createSelfSignedCertificate({
      privateKey,
      publicKey,
      serialHex: randomBytes(8)
        .toString("hex")
        .replace(/^[89a-f]/, "1"),
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 3_600_000),
      attributes: [{ name: "commonName", value: "localhost" }],
      dns: ["localhost"],
      ip: ["127.0.0.1"],
      hash: "sha256",
    });
    const key = privateKey.export({ type: "pkcs8", format: "pem" });
    const server = http2.createSecureServer({ key, cert, allowHTTP1: true });
    let calls = 0;
    setHttp2SessionTimeout(server, IDLE, () => calls++);
    server.on("request", (_req, res) => res.end("ok"));
    // Le fait attendu : l'échéance de la socket HTTP/1.1 est PASSÉE par
    // l'écouteur du serveur (et, la garde absente, elle y aurait levé).
    const socketTimedOut = new Promise<void>((r) =>
      server.on("timeout", (target: unknown) => {
        if (target instanceof Socket) r();
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    // Une connexion négociée en HTTP/1.1 qui n'envoie rien : avant toute
    // requête, c'est `server.timeout` qui s'applique à la socket (Node,
    // `_http_server.js#connectionListenerInternal`) — après une réponse, ce
    // serait `keepAliveTimeout`.
    const client = tls.connect({
      host: "127.0.0.1",
      port,
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: false,
    });
    client.on("error", () => {});
    await new Promise<void>((r) => client.once("secureConnect", () => r()));
    expect(client.alpnProtocol).to.equal("http/1.1");
    await socketTimedOut;
    expect(calls, "aucun avis pour une socket HTTP/1.1").to.equal(0);
    client.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });
});

describe("setHttp2SessionTimeout — garde d'arguments", () => {
  it("délai 0 ou absent : aucun écouteur `timeout`", () => {
    const server = http2.createServer();
    setHttp2SessionTimeout(server, 0, () => {});
    setHttp2SessionTimeout(server, undefined, () => {});
    expect(server.listenerCount("timeout")).to.equal(0);
  });
});
