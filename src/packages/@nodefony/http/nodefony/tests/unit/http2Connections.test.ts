/// <reference types="node" />
//
// ─── Connexions HTTP/2 : âge maximal, keepalive, police des PING (#770) ─────
//
// Normes : RFC 9113 §6.7 (PING), §6.8 (GOAWAY en deux temps), §9.1, §10.5
// (ENHANCE_YOUR_CALM) ; gRPC A9 (MAX_CONNECTION_AGE, ± 10 %, GRACE, keepalive
// serveur, debug « max_age ») ; gRPC A8 (ping strikes, « too_many_pings »).
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `manageHttp2Connections` : l'écouteur `session` (aucune session suivie) ;
//   - `Http2ConnectionManager.add` : l'armement du minuteur ;
//   - `http2ConnectionTick` : la branche d'âge, de grâce, ou le keepalive ;
//   - `judgeReceivedPing` : la remise à zéro sur trame écrite, ou le seuil ;
//   - `Http2ConnectionManager.#calm` : une destruction dans le rappel du PING
//     (0 ACK reçu), le filet, ou la garde « déjà puni » ;
//   - `ShutdownRegistry.endSession` / `StreamLifecycle.belongsTo`.
//
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { httpConfigSchema } from "../../config/config";
import type HttpContext from "../../src/context/http/HttpContext";
import {
  ShutdownRegistry,
  StreamLifecycle,
} from "../../src/context/http/StreamLifecycle";
import {
  Http2ConnectionManager,
  Http2SessionState,
  connectionAgeDeadline,
  http2ConnectionPolicy,
  http2ConnectionTick,
  judgeReceivedPing,
  manageHttp2Connections,
  type IHttp2ConnectionPolicy,
  type IHttp2SessionActions,
} from "../../src/servers/http2Connections";

const LAST_POSSIBLE_STREAM = 2 ** 31 - 1;

function policy(
  overrides: Partial<IHttp2ConnectionPolicy>,
): IHttp2ConnectionPolicy {
  return {
    maxConnectionAge: 0,
    maxConnectionAgeGrace: Infinity,
    keepaliveInterval: 0,
    keepaliveTimeout: 20_000,
    minPingInterval: 0,
    maxPingStrikes: 2,
    ...overrides,
  };
}

/** Une session factice : ce que les gestes en ont fait, et ses octets lus. */
interface IFakeSession {
  read: number;
  gone: boolean;
  log: string[];
  streams: number;
}

function fakeSession(): IFakeSession {
  return { read: 0, gone: false, log: [], streams: 0 };
}

const fakeActions: IHttp2SessionActions<IFakeSession> = {
  alive: (s) => !s.gone,
  bytesRead: (s) => s.read,
  ping: (s) => {
    s.log.push("ping");
    return true;
  },
  announceAge: (s) => {
    s.log.push("age");
  },
  endStreams: (s) => {
    s.log.push("end");
    return s.streams;
  },
  destroy: (s) => {
    s.log.push("destroy");
    s.gone = true;
  },
};

function track(session: IFakeSession, ageDeadline = Infinity) {
  return new Http2SessionState(session, 0, ageDeadline, session.read, 0);
}

describe("http2 — config : section strict, clés neuves, défauts", () => {
  it("aucune clé posée : aucune politique (rien ne sera armé)", () => {
    expect(http2ConnectionPolicy(httpConfigSchema.parse({}).http2)).to.equal(
      null,
    );
  });

  it("une clé posée : politique résolue, défauts A8/A9 sur les autres", () => {
    const p = http2ConnectionPolicy(
      httpConfigSchema.parse({ http2: { maxConnectionAge: 60_000 } }).http2,
    );
    expect(p).to.deep.equal({
      maxConnectionAge: 60_000,
      maxConnectionAgeGrace: Infinity,
      keepaliveInterval: 0,
      keepaliveTimeout: 20_000,
      minPingInterval: 0,
      maxPingStrikes: 2,
    });
  });

  it("clé mal orthographiée : refusée en la nommant, plus jamais ignorée", () => {
    const parsed = httpConfigSchema.safeParse({
      http2: { maxConectionAge: 60_000 },
    });
    expect(parsed.success).to.equal(false);
    expect(JSON.stringify(parsed.error?.issues)).to.contain("maxConectionAge");
  });
});

describe("http2 — âge maximal et délai de grâce (règle pure, gRPC A9)", () => {
  it("aléa ± 10 % par connexion ; âge 0 = jamais", () => {
    expect(connectionAgeDeadline(100, 1000, 0)).to.equal(1000);
    expect(connectionAgeDeadline(100, 1000, 0.5)).to.equal(1100);
    expect(connectionAgeDeadline(100, 1000, 0.999_999)).to.be.closeTo(
      1200,
      0.01,
    );
    expect(connectionAgeDeadline(100, 0, 0.5)).to.equal(Infinity);
  });

  it("GOAWAY d'âge à l'échéance, pas avant, une seule fois", () => {
    const s = fakeSession();
    const states = [track(s, 1000)];
    const p = policy({ maxConnectionAge: 1000 });
    http2ConnectionTick(states, 999, p, fakeActions);
    expect(s.log).to.deep.equal([]);
    http2ConnectionTick(states, 1000, p, fakeActions);
    http2ConnectionTick(states, 5000, p, fakeActions);
    expect(s.log).to.deep.equal(["age"]);
  });

  it("grâce bornée : flux longs terminés au terme, pas avant ; destruction après leur attente", () => {
    const s = fakeSession();
    s.streams = 1;
    const states = [track(s, 1000)];
    const p = policy({ maxConnectionAge: 1000, maxConnectionAgeGrace: 500 });
    http2ConnectionTick(states, 1000, p, fakeActions);
    http2ConnectionTick(states, 1499, p, fakeActions);
    expect(s.log).to.deep.equal(["age"]);
    http2ConnectionTick(states, 1500, p, fakeActions);
    expect(s.log).to.deep.equal(["age", "end"]);
    http2ConnectionTick(states, 2499, p, fakeActions);
    expect(s.log).to.deep.equal(["age", "end"]);
    http2ConnectionTick(states, 2500, p, fakeActions);
    expect(s.log).to.deep.equal(["age", "end", "destroy"]);
  });

  it("grâce bornée sans flux long : détruite aussitôt au terme", () => {
    const s = fakeSession();
    const states = [track(s, 1000)];
    const p = policy({ maxConnectionAge: 1000, maxConnectionAgeGrace: 500 });
    http2ConnectionTick(states, 1000, p, fakeActions);
    http2ConnectionTick(states, 1500, p, fakeActions);
    expect(s.log).to.deep.equal(["age", "end", "destroy"]);
  });

  it("grâce absente : sans borne (A9), jamais coupée", () => {
    const s = fakeSession();
    const states = [track(s, 1000)];
    const p = policy({ maxConnectionAge: 1000 });
    http2ConnectionTick(states, 1000, p, fakeActions);
    http2ConnectionTick(states, 1e12, p, fakeActions);
    expect(s.log).to.deep.equal(["age"]);
  });
});

describe("http2 — keepalive (règle pure, gRPC A8/A9)", () => {
  const p = policy({ keepaliveInterval: 100, keepaliveTimeout: 50 });

  it("pair muet puis gelé : PING après l'intervalle, détruit au délai, pas avant", () => {
    const s = fakeSession();
    const states = [track(s)];
    http2ConnectionTick(states, 99, p, fakeActions);
    expect(s.log).to.deep.equal([]);
    http2ConnectionTick(states, 100, p, fakeActions);
    http2ConnectionTick(states, 149, p, fakeActions);
    expect(s.log).to.deep.equal(["ping"]);
    http2ConnectionTick(states, 150, p, fakeActions);
    expect(s.log).to.deep.equal(["ping", "destroy"]);
  });

  it("témoin : pair vivant et muet (l'ACK arrive) — jamais fermé", () => {
    const s = fakeSession();
    const states = [track(s)];
    for (let now = 50; now <= 10_000; now += 50) {
      const before = s.log.length;
      http2ConnectionTick(states, now, p, fakeActions);
      if (s.log.length > before) s.read += 17; // l'ACK du PING qui vient de partir
    }
    expect(s.log).to.not.contain("destroy");
    expect(s.log.filter((l) => l === "ping").length).to.be.greaterThan(10);
  });

  it("pair qui parle : aucun PING", () => {
    const s = fakeSession();
    const states = [track(s)];
    for (let now = 50; now <= 10_000; now += 50) {
      s.read += 1;
      http2ConnectionTick(states, now, p, fakeActions);
    }
    expect(s.log).to.deep.equal([]);
  });

  it("session détruite ailleurs : plus aucun geste", () => {
    const s = fakeSession();
    s.gone = true;
    http2ConnectionTick(
      [track(s, 0)],
      1e9,
      policy({ maxConnectionAge: 1, keepaliveInterval: 1 }),
      fakeActions,
    );
    expect(s.log).to.deep.equal([]);
  });
});

describe("http2 — police des PING reçus (règle pure, gRPC A8)", () => {
  const p = policy({ minPingInterval: 1000, maxPingStrikes: 2 });

  it("rafale : la 3ᵉ faute au-delà de 2 tolérées est un abus", () => {
    const state = track(fakeSession());
    let written = 0;
    const verdicts = [0, 10, 20, 30].map((now) => {
      const v = judgeReceivedPing(state, now, written, p);
      written += 17; // l'ACK, seul écrit
      return v;
    });
    expect(verdicts).to.deep.equal([false, false, false, true]);
  });

  it("témoin : un PING par intervalle — jamais un abus", () => {
    const state = track(fakeSession());
    let written = 0;
    for (let now = 0; now <= 20_000; now += 1000) {
      expect(judgeReceivedPing(state, now, written, p)).to.equal(false);
      written += 17;
    }
  });

  it("le serveur écrit des trames (HEADERS/DATA) entre deux PING : compte remis à zéro (A8)", () => {
    const state = track(fakeSession());
    let written = 0;
    for (let now = 0; now <= 1000; now += 10) {
      expect(judgeReceivedPing(state, now, written, p)).to.equal(false);
      written += 17 + 5000; // ACK + une réponse
    }
  });

  it("les PING de keepalive du serveur ne passent pas pour des données", () => {
    const session = fakeSession();
    const state = track(session);
    expect(judgeReceivedPing(state, 0, 0, p)).to.equal(false);
    // Un tour de keepalive émet un PING (17 octets écrits, comme l'ACK).
    http2ConnectionTick(
      [state],
      5,
      { ...p, keepaliveInterval: 1 },
      fakeActions,
    );
    expect(session.log).to.deep.equal(["ping"]);
    expect(judgeReceivedPing(state, 10, 34, p)).to.equal(false);
    expect(judgeReceivedPing(state, 20, 51, p)).to.equal(false);
    expect(judgeReceivedPing(state, 30, 68, p)).to.equal(true);
  });
});

// ─── Sur de vraies sessions h2c ─────────────────────────────────────────────

const servers: http2.Http2Server[] = [];
const clients: http2.ClientHttp2Session[] = [];
const sockets: net.Socket[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});

async function listen(server: http2.Http2Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function connect(port: number): Promise<http2.ClientHttp2Session> {
  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", () => {});
  clients.push(client);
  await new Promise<void>((r) => client.once("connect", () => r()));
  return client;
}

function get(
  client: http2.ClientHttp2Session,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = client.request({ ":path": "/" });
    let status = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("response", (h) => (status = Number(h[":status"])));
    req.on("data", (c: string) => (body += c));
    req.on("end", () => resolve({ status, body }));
    req.on("error", reject);
  });
}

/** Trame PING (RFC 9113 §6.7) : 8 octets de charge, flux 0. */
function pingFrame(n: number): Buffer {
  const frame = Buffer.alloc(17);
  frame.writeUIntBE(8, 0, 3);
  frame[3] = 0x6;
  frame.writeUInt32BE(n, 13);
  return frame;
}

/**
 * Lit les trames qu'un serveur écrit sur une socket brute : compte les ACK de
 * PING, rend le premier GOAWAY (RFC 9113 §6.8 : dernier flux, code, données).
 */
function readFrames(socket: net.Socket) {
  let buffer = Buffer.alloc(0);
  let acks = 0;
  let resolveGoaway: (g: { code: number; data: string; at: number }) => void;
  const goaway = new Promise<{ code: number; data: string; at: number }>(
    (r) => (resolveGoaway = r),
  );
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 9) {
      const length = buffer.readUIntBE(0, 3);
      if (buffer.length < 9 + length) break;
      const type = buffer.readUInt8(3);
      const flags = buffer.readUInt8(4);
      const payload = buffer.subarray(9, 9 + length);
      if (type === 0x6 && (flags & 0x1) === 0x1) acks += 1;
      if (type === 0x7) {
        resolveGoaway({
          code: payload.readUInt32BE(4),
          data: payload.subarray(8).toString(),
          at: performance.now(),
        });
      }
      buffer = buffer.subarray(9 + length);
    }
  });
  return { goaway, pingAcks: () => acks };
}

function goaway(client: http2.ClientHttp2Session) {
  return new Promise<{ code: number; last: number; data: string; at: number }>(
    (r) =>
      client.once("goaway", (code, last, data) =>
        r({ code, last, data: data?.toString() ?? "", at: performance.now() }),
      ),
  );
}

function config(http2Keys: Record<string, number>) {
  return httpConfigSchema.parse({ http2: http2Keys }).http2;
}

describe("http2 — âge maximal sur une vraie session h2c", () => {
  it("GOAWAY « max_age » à 2^31-1 ; l'unaire en cours va à son terme ; le suivant part sur une autre connexion", async () => {
    const server = http2.createServer();
    const held: http2.ServerHttp2Stream[] = [];
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      // Le 1ᵉʳ flux ne répond qu'APRÈS le GOAWAY : il le traverse forcément.
      if (held.length === 0) {
        held.push(stream);
        return;
      }
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    const manager = manageHttp2Connections(
      server,
      config({ maxConnectionAge: 300 }),
      () => 0,
      () => {},
    );
    expect(manager).to.not.equal(null);
    const port = await listen(server);
    const client = await connect(port);
    const announced = goaway(client);
    const inFlight = get(client);
    const g = await announced;
    expect(g).to.include({
      code: 0,
      last: LAST_POSSIBLE_STREAM,
      data: "max_age",
    });
    const stream = held[0];
    if (stream === undefined)
      throw new Error("le 1ᵉʳ flux aurait dû être retenu");
    stream.respond({ ":status": 200 });
    stream.end("ok");
    expect(await inFlight).to.deep.equal({ status: 200, body: "ok" });
    // RFC 9113 §6.8 : plus aucun flux sur cette connexion — le client le refuse.
    await expect(get(client)).rejects.toMatchObject({
      code: "ERR_HTTP2_GOAWAY_SESSION",
    });
    const fresh = await connect(port);
    expect((await get(fresh)).status).to.equal(200);
  });
});

describe("http2 — délai de grâce : le flux long reçoit sa fin (ADR-0026 D8)", () => {
  it("au terme de la grâce, pas avant, pas jamais ; puis la connexion tombe", async () => {
    const registry = new ShutdownRegistry();
    const server = http2.createServer();
    let endedByShutdown = 0;
    server.on("request", (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ouvert\n\n");
      const context = {
        rpc: null,
        httpKernel: {
          trackStream: (s: StreamLifecycle) => registry.add(s),
          untrackStream: (s: StreamLifecycle) => registry.delete(s),
        },
        // La fin SSE de la brique (ADR-0026 D8) : fermeture simple du flux.
        close: () => {
          endedByShutdown += 1;
          res.end();
        },
      };
      const lifecycle = new StreamLifecycle(
        // Doublure : seuls `rpc`, `httpKernel` et `close` sont lus par la brique.
        context as unknown as HttpContext,
        res.stream, // la cible HTTP/2 est le flux (`resolveStreamTarget`)
        res,
        {
          stallTimeout: false,
          maxDuration: false,
          revalidate: null,
          identifier: null,
          foreignWriter: false,
          endsAtShutdown: true,
        },
      );
      res.once("close", () => registry.delete(lifecycle));
    });
    const GRACE = 400;
    manageHttp2Connections(
      server,
      config({ maxConnectionAge: 300, maxConnectionAgeGrace: GRACE }),
      (session) => registry.endSession(session),
      () => {},
    );
    const port = await listen(server);
    const client = await connect(port);
    const announced = goaway(client);
    const ended = new Promise<number>((resolve, reject) => {
      const req = client.request({ ":path": "/events" });
      req.resume();
      req.on("end", () => resolve(performance.now()));
      req.on("error", reject);
    });
    const g = await announced;
    const endAt = await ended;
    // La grâce compte depuis l'annonce, qui précède le GOAWAY lu par le client.
    expect(endAt - g.at, "fin du flux après la grâce").to.be.at.least(
      GRACE - 50,
    );
    expect(
      endedByShutdown,
      "fin par la brique, pas par la connexion détruite",
    ).to.equal(1);
    await new Promise<void>((r) =>
      client.closed ? r() : client.once("close", () => r()),
    );
    expect(registry.size).to.equal(0);
  });
});

describe("http2 — keepalive sur de vraies connexions", () => {
  it("pair gelé (préface puis silence, aucun ACK) : connexion détruite après le délai", async () => {
    const server = http2.createServer();
    manageHttp2Connections(
      server,
      config({ keepaliveInterval: 200, keepaliveTimeout: 300 }),
      () => 0,
      () => {},
    );
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    socket.on("error", () => {});
    socket.resume();
    await new Promise<void>((r) => socket.once("connect", () => r()));
    // Préface client + SETTINGS vide, puis plus rien : ni ACK, ni réponse au PING.
    socket.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
    const t0 = performance.now();
    await new Promise<void>((r) => socket.once("close", () => r()));
    // Pas avant intervalle + délai (200 + 300, moins un tour) ; « pas jamais » :
    // la fermeture est attendue, le délai du test la borne.
    expect(performance.now() - t0).to.be.at.least(400);
  });

  it("destruction : le délai d'inactivité est désarmé AVANT (nodejs/node#66885), la session n'est pas retenue", async () => {
    const IDLE = 60_000;
    const server = http2.createServer();
    server.setTimeout(IDLE, () => {});
    manageHttp2Connections(
      server,
      config({ keepaliveInterval: 200, keepaliveTimeout: 300 }),
      () => 0,
      () => {},
    );
    const closed = new Promise<http2.ServerHttp2Session>((resolve) =>
      server.once("session", (s) => s.once("close", () => resolve(s))),
    );
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    socket.on("error", () => {});
    socket.resume();
    await new Promise<void>((r) => socket.once("connect", () => r()));
    socket.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
    const session = await closed;
    expect(session.destroyed).to.equal(true);
    // `timeout` existe à l'exécution sur la session, pas dans ses types.
    expect(Reflect.get(session, "timeout"), "minuteur désarmé").to.equal(0);
  });

  it("témoin : pair vivant et muet — pingué, jamais fermé", async () => {
    const server = http2.createServer();
    manageHttp2Connections(
      server,
      config({ keepaliveInterval: 200, keepaliveTimeout: 300 }),
      () => 0,
      () => {},
    );
    const port = await listen(server);
    const client = await connect(port);
    let pings = 0;
    client.on("ping", () => (pings += 1));
    await new Promise((r) => setTimeout(r, 1500));
    expect(pings, "le serveur a pingué").to.be.at.least(2);
    expect(client.closed || client.destroyed, "connexion vivante").to.equal(
      false,
    );
  });
});

describe("http2 — police des PING sur de vraies connexions (gRPC A8)", () => {
  it("rafale : GOAWAY ENHANCE_YOUR_CALM « too_many_pings », le client ferme, signalée", async () => {
    const server = http2.createServer();
    const abuses: (string | undefined)[] = [];
    manageHttp2Connections(
      server,
      config({ minPingInterval: 1000 }),
      () => 0,
      (r) => abuses.push(r),
    );
    const port = await listen(server);
    const client = await connect(port);
    const announced = goaway(client);
    const closed = new Promise<void>((r) => client.once("close", () => r()));
    for (let i = 0; i < 4; i++) client.ping(() => {});
    const g = await announced;
    expect(g.code).to.equal(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);
    expect(g.data).to.equal("too_many_pings");
    await closed;
    expect(abuses).to.deep.equal(["127.0.0.1"]);
  });

  it("pair qui ne ferme pas : ACK et GOAWAY reçus, puni UNE fois, coupé par le serveur — jamais dans le rappel du PING", async () => {
    // La destruction dans le rappel `ping` jetait les trames en file (ACK et
    // GOAWAY) quand une écriture était en cours — sous TLS, le client voyait
    // une fin de connexion nue. Ici le pair ne ferme jamais : c'est le SERVEUR
    // qui doit couper (sans quoi la session vivrait — nghttp2 ne lit plus rien
    // après son GOAWAY), et les PING suivants ne punissent pas une seconde fois.
    const server = http2.createServer();
    const abuses: (string | undefined)[] = [];
    manageHttp2Connections(
      server,
      config({ minPingInterval: 1000 }),
      () => 0,
      (r) => abuses.push(r),
    );
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    socket.on("error", () => {});
    await once(socket, "connect");
    const frames = readFrames(socket);
    socket.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0])); // SETTINGS vide
    socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0])); // ACK des SETTINGS
    // Huit PING d'une seule écriture : lus d'un trait, ceux qui suivent la
    // punition arrivent encore au rappel — ils ne doivent pas punir de nouveau.
    socket.write(
      Buffer.concat(Array.from({ length: 8 }, (_, i) => pingFrame(i))),
    );
    const g = await frames.goaway;
    expect(g.code).to.equal(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);
    expect(g.data).to.equal("too_many_pings");
    // L'ACK du 4ᵉ PING est mis en file AVANT le GOAWAY : rien n'a été jeté.
    expect(frames.pingAcks()).to.be.at.least(4);
    await once(socket, "close");
    expect(abuses).to.deep.equal(["127.0.0.1"]);
  });

  it("témoin : un client au rythme permis n'est jamais touché", async () => {
    const server = http2.createServer();
    const abuses: (string | undefined)[] = [];
    manageHttp2Connections(
      server,
      config({ minPingInterval: 200 }),
      () => 0,
      (r) => abuses.push(r),
    );
    const port = await listen(server);
    const client = await connect(port);
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve, reject) =>
        client.ping((err) => (err ? reject(err) : resolve())),
      );
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(abuses).to.deep.equal([]);
    expect(client.closed).to.equal(false);
  });
});

describe("http2 — clé absente : comportement d'aujourd'hui, compté", () => {
  it("aucun écouteur ajouté au serveur, aucun gestionnaire", () => {
    const server = http2.createServer();
    const before = server.listenerCount("session");
    expect(
      manageHttp2Connections(
        server,
        httpConfigSchema.parse({}).http2,
        () => 0,
        () => {},
      ),
    ).to.equal(null);
    expect(server.listenerCount("session")).to.equal(before);
  });

  it("minuteur armé à la 1ʳᵉ session, arrêté à la dernière ; police seule : jamais de minuteur", async () => {
    const server = http2.createServer();
    const manager = manageHttp2Connections(
      server,
      config({ keepaliveInterval: 10_000 }),
      () => 0,
      () => {},
    );
    if (manager === null) throw new Error("gestionnaire attendu");
    const port = await listen(server);
    expect(manager.ticking).to.equal(false);
    const opened = once(server, "session");
    const client = await connect(port);
    const [session] = (await opened) as [http2.ServerHttp2Session];
    expect([manager.size, manager.ticking]).to.deep.equal([1, true]);
    const serverClosed = once(session, "close");
    client.close();
    await serverClosed;
    expect([manager.size, manager.ticking]).to.deep.equal([0, false]);

    const policing = new Http2ConnectionManager(
      policy({ minPingInterval: 1000 }),
      () => 0,
      () => {},
    );
    const server2 = http2.createServer();
    server2.on("session", (s) => policing.add(s));
    const opened2 = once(server2, "session");
    await connect(await listen(server2));
    await opened2;
    expect([policing.size, policing.ticking]).to.deep.equal([1, false]);
  });
});
