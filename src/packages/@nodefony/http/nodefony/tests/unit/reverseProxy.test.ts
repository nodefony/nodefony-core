/// <reference types="node" />
/**
 * Unit (réseau réel, boucle locale) — proxy inverse `ReverseProxy`.
 *
 * Chaque cas monte un AMONT réel (`node:http`, `ws`) et un FRONT réel qui
 * délègue au proxy exactement comme le pipeline : `forward()` avant le
 * routage, `handleUpgrade()` dans le répartiteur d'upgrade. On observe ce qui
 * TRAVERSE — en-têtes reçus par l'amont, statut et en-têtes reçus par le
 * client —, jamais l'état interne : un filtre d'en-tête qui ne filtre pas se
 * voit ici, pas dans un objet.
 *
 * Le front HTTP/2 est le cas qui mord : un serveur Node pose d'office
 * `Connection` et `Keep-Alive`, que HTTP/2 INTERDIT (RFC 9113 §8.2.2) — une
 * réponse amont recopiée telle quelle fait lever `writeHead`.
 *
 * Le branchement dans le serveur Nodefony (pipeline, `trustedHosts`, Vite) est
 * éprouvé sur le serveur réel : `tests/http/reverse-proxy.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import v8 from "node:v8";
import vm from "node:vm";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import ReverseProxy from "../../service/reverse-proxy";
import HttpKernel from "../../service/http-kernel";
import { MAX_VIA_HOPS } from "../../src/proxy/forward";
import { createSelfSignedCertificate } from "../../service/x509";
import type { IProxyMountOptions } from "../../interfaces/IReverseProxy";

/** Ce que l'amont a reçu, pour l'assertion. */
interface ISeen {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

function closeServer(server: net.Server): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      if ("closeAllConnections" in server) {
        (server as http.Server).closeAllConnections();
      }
      server.close(() => resolve());
    });
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(closeServer(server));
  return (server.address() as AddressInfo).port;
}

/** Proxy sans noyau : la section `proxy` passe par les options du module. */
function proxyWith(
  mounts: Record<string, IProxyMountOptions> = {},
  timeoutMs = 30_000,
  connectTimeoutMs = 5_000,
  maxSockets = 16,
): ReverseProxy {
  const module = {
    container: undefined,
    options: { proxy: { timeoutMs, connectTimeoutMs, maxSockets, mounts } },
  } as unknown as Module;
  const proxy = new ReverseProxy(module);
  proxy.log = (() => undefined) as unknown as ReverseProxy["log"];
  return proxy;
}

/** Règles du noyau HTTP, telles que le proxy les lit (résolues par nom). */
function withRules(
  proxy: ReverseProxy,
  rules: {
    trusted?: (address: string | undefined) => boolean;
    origin?: (origin: string | undefined, hostname: string) => boolean;
    host?: (hostname: string) => boolean;
    domainCheck?: boolean;
    /** Règle de quotas WebSocket — celle d'un VRAI noyau, cf {@link kernelWith}. */
    quota?: HttpKernel["websocketQuotaRefusal"];
  },
): ReverseProxy {
  proxy.container?.set("HttpKernel", {
    isTrustedHostname: rules.host ?? (() => true),
    getTrustProxyChecker: () => ({ isTrusted: rules.trusted ?? (() => false) }),
    isWebsocketOriginAllowed: (o: string | undefined, h: string) =>
      rules.origin ? rules.origin(o, h) : true,
    websocketQuotaRefusal: rules.quota ?? (() => null),
  });
  if (rules.domainCheck) {
    (proxy as unknown as { kernel: unknown }).kernel = {
      options: { domainCheck: true },
    };
  }
  return proxy;
}

/**
 * Un VRAI noyau HTTP, quotas WebSocket armés : la règle éprouvée est celle que
 * sert le serveur, pas une copie de test.
 */
function kernelWith(quotas: {
  wsMaxConnectionsPerIp?: number;
  rateMax?: number;
}): HttpKernel {
  const module = {
    container: new Container(),
    notificationsCenter: new Event(),
    options: {
      http: { responseTimeout: 1_000 },
      https: { responseTimeout: 1_000 },
      websocket: { closeTimeout: 1_000 },
      websocketSecure: { closeTimeout: 1_000 },
      wsMaxConnectionsPerIp: quotas.wsMaxConnectionsPerIp ?? null,
      rateLimit: {
        enabled: quotas.rateMax !== undefined,
        windowS: 60,
        max: quotas.rateMax ?? 1,
        maxTracked: 100,
        gcIntervalS: 3_600,
        gcJitter: false,
      },
    },
  } as unknown as Module;
  const kernel = new HttpKernel(module);
  const armed = kernel as unknown as {
    configureRateLimit(): void;
    configureWsConnectionLimit(): void;
    rateLimitGc: { stop(): void } | null;
  };
  armed.configureRateLimit();
  armed.configureWsConnectionLimit();
  closers.push(async () => armed.rateLimitGc?.stop());
  return kernel;
}

/** Amont HTTP qui rend ce que décide `reply` et note ce qu'il a reçu. */
async function upstream(
  reply: (req: http.IncomingMessage, res: http.ServerResponse) => void = (
    _req,
    res,
  ) => {
    res.end("amont");
  },
): Promise<{ origin: string; seen: ISeen[]; server: http.Server }> {
  const seen: ISeen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      reply(req, res);
    });
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, seen, server };
}

/** Front HTTP/1.1 qui délègue au proxy, 404 sinon — comme le pipeline. */
async function front(proxy: ReverseProxy): Promise<number> {
  const server = http.createServer((req, res) => {
    const relayed = proxy.forward(req, res, "http");
    if (relayed === undefined) {
      res.writeHead(404);
      res.end("routage");
    }
  });
  server.on(
    "upgrade",
    (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!proxy.handleUpgrade(req, socket, head)) socket.destroy();
    },
  );
  return listen(server);
}

interface IAnswer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(
  port: number,
  path: string,
  options: {
    method?: string;
    headers?: http.OutgoingHttpHeaders;
    body?: string;
  } = {},
): Promise<IAnswer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
        agent: false,
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** Un port où personne n'écoute : ouvert, lu, refermé. */
async function deadPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

describe("ReverseProxy — requêtes HTTP/1.1", () => {
  it("relaie méthode, chemin et requête intacts ; rend statut et corps de l'amont", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(201, { "x-amont": "oui" });
      res.end("créé");
    });
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await get(port, "/svc/a/b?x=1&y=%20");
    expect(r.status).toBe(201);
    expect(r.body).toBe("créé");
    expect(r.headers["x-amont"]).toBe("oui");
    expect(up.seen[0]?.url).toBe("/svc/a/b?x=1&y=%20");
    expect(up.seen[0]?.method).toBe("GET");
  });

  it("une URL hors préfixe n'est pas relayée : elle suit le routage", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    expect((await get(port, "/svcx")).body).toBe("routage");
    expect((await get(port, "/svc")).body).toBe("routage");
    expect(up.seen).toHaveLength(0);
  });

  const forged = {
    host: "app.example.test",
    "x-forwarded-for": "203.0.113.7",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "forge.example.test",
    forwarded: "for=203.0.113.7;proto=https",
    "x-real-ip": "203.0.113.7",
  };

  it("pair NON fiable : réécrit Host, recommence la chaîne, écarte Forwarded/X-Real-IP forgés (RFC 7239 §8.1)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    await get(port, "/svc/", { headers: forged });
    const h = up.seen[0]?.headers ?? {};
    expect(h.host).toBe(new URL(up.origin).host);
    expect(h["x-forwarded-host"]).toBe("app.example.test");
    expect(h["x-forwarded-proto"]).toBe("http");
    expect(h["x-forwarded-for"]).toBe("127.0.0.1");
    expect(h.forwarded).toBeUndefined();
    expect(h["x-real-ip"]).toBeUndefined();
  });

  it("pair de CONFIANCE (`trustProxy`) : prolonge la chaîne et garde ce qu'il a établi", async () => {
    const up = await upstream();
    const proxy = withRules(proxyWith({ "/svc/": { target: up.origin } }), {
      trusted: (a) => a === "127.0.0.1",
    });
    const port = await front(proxy);
    await get(port, "/svc/", { headers: forged });
    const h = up.seen[0]?.headers ?? {};
    expect(h["x-forwarded-for"]).toBe("203.0.113.7, 127.0.0.1");
    expect(h["x-forwarded-proto"]).toBe("https");
    expect(h["x-forwarded-host"]).toBe("forge.example.test");
    // Chaîne `Forwarded` ouverte par le relais : prolongée de CE saut (RFC 7239 §4).
    expect(h.forwarded).toBe(
      "for=203.0.113.7;proto=https, for=127.0.0.1;proto=http;host=app.example.test",
    );
  });

  it("`Forwarded` n'est jamais CRÉÉ : sans chaîne ouverte par un relais fiable, X-Forwarded-* suffit", async () => {
    const up = await upstream();
    const proxy = withRules(proxyWith({ "/svc/": { target: up.origin } }), {
      trusted: (a) => a === "127.0.0.1",
    });
    const port = await front(proxy);
    await get(port, "/svc/", { headers: { host: "app.example.test:8443" } });
    expect(up.seen[0]?.headers.forwarded).toBeUndefined();
  });

  it("`X-Forwarded-Prefix` prolonge celui d'un relais fiable ; venu d'ailleurs, il est remplacé", async () => {
    const up = await upstream();
    const mounts = { "/svc/": { target: up.origin, stripPrefix: true } };
    const trusting = await front(
      withRules(proxyWith(mounts), { trusted: (a) => a === "127.0.0.1" }),
    );
    await get(trusting, "/svc/a", {
      headers: { "x-forwarded-prefix": "/edge/" },
    });
    expect(up.seen[0]?.headers["x-forwarded-prefix"]).toBe("/edge/svc");
    const direct = await front(proxyWith(mounts));
    await get(direct, "/svc/a", { headers: { "x-forwarded-prefix": "/edge" } });
    expect(up.seen[1]?.headers["x-forwarded-prefix"]).toBe("/svc");
  });

  it("`preserveHost` transmet le Host du client", async () => {
    const up = await upstream();
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin, preserveHost: true } }),
    );
    await get(port, "/svc/", { headers: { host: "app.example.test:8443" } });
    expect(up.seen[0]?.headers.host).toBe("app.example.test:8443");
  });

  it("ne transmet AUCUN en-tête de connexion, ni ceux que nomme `Connection` (RFC 9110 §7.6.1)", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, {
        connection: "x-saut-amont",
        "x-saut-amont": "secret",
        "proxy-authenticate": "Basic",
      });
      res.end("ok");
    });
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await get(port, "/svc/", {
      headers: {
        connection: "x-saut-client",
        "x-saut-client": "secret",
        "proxy-authorization": "Basic Zm9vOmJhcg==",
        te: "trailers",
      },
    });
    const h = up.seen[0]?.headers ?? {};
    expect(h["x-saut-client"]).toBeUndefined();
    expect(h["proxy-authorization"]).toBeUndefined();
    expect(h.te).toBeUndefined();
    expect(r.headers["x-saut-amont"]).toBeUndefined();
    expect(r.headers["proxy-authenticate"]).toBeUndefined();
  });

  it("`stripHeaders` retire ce dont l'amont n'a pas l'usage, quelle que soit la casse", async () => {
    const up = await upstream();
    const port = await front(
      proxyWith({
        "/svc/": {
          target: up.origin,
          stripHeaders: ["Cookie", "AUTHORIZATION"],
        },
      }),
    );
    await get(port, "/svc/", {
      headers: {
        cookie: "session=1",
        authorization: "Bearer x",
        "x-garde": "1",
      },
    });
    const h = up.seen[0]?.headers ?? {};
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h["x-garde"]).toBe("1");
  });

  it("`stripPrefix` retire le préfixe et garde la requête", async () => {
    const up = await upstream();
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin, stripPrefix: true } }),
    );
    await get(port, "/svc/a?b=1");
    expect(up.seen[0]?.url).toBe("/a?b=1");
    expect(up.seen[0]?.headers["x-forwarded-prefix"]).toBe("/svc");
  });

  it("`methods` borne ce qui est relayé : une autre méthode suit le routage", async () => {
    const up = await upstream();
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin, methods: ["get", "HEAD"] } }),
    );
    expect((await get(port, "/svc/", { method: "POST", body: "x" })).body).toBe(
      "routage",
    );
    expect((await get(port, "/svc/")).body).toBe("amont");
    expect(up.seen).toHaveLength(1);
  });

  it("relaie le corps d'une méthode qui en porte un", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const body = "x".repeat(200_000);
    await get(port, "/svc/", {
      method: "POST",
      body,
      headers: { "content-type": "text/plain", "content-length": body.length },
    });
    expect(up.seen[0]?.body).toBe(body);
  });

  it("garde un `set-cookie` multiple intact", async () => {
    const up = await upstream((_req, res) => {
      res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
      res.end();
    });
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await get(port, "/svc/");
    expect(r.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("amont injoignable → 502, sans détail interne", async () => {
    const port = await front(
      proxyWith({
        "/svc/": { target: `http://127.0.0.1:${await deadPort()}` },
      }),
    );
    const r = await get(port, "/svc/");
    expect(r.status).toBe(502);
    expect(r.body).toBe("Bad Gateway");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("amont muet au-delà du délai → 504, une seule réponse", async () => {
    const up = await upstream(() => undefined);
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin, timeoutMs: 150 } }),
    );
    const r = await get(port, "/svc/");
    expect(r.status).toBe(504);
    expect(r.body).toBe("Gateway Timeout");
  });

  it("le délai par défaut vient de la section (`proxy.timeoutMs`)", async () => {
    const up = await upstream(() => undefined);
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin } }, 150),
    );
    expect((await get(port, "/svc/")).status).toBe(504);
  });

  it("un client parti coupe l'échange amont", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    const server = http.createServer((req) => {
      req.socket.on("close", () => upstreamClosed());
    });
    const port = await front(
      proxyWith({
        "/svc/": { target: `http://127.0.0.1:${await listen(server)}` },
      }),
    );
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/svc/",
      agent: false,
    });
    req.on("error", () => undefined);
    req.end();
    await new Promise((r) => setTimeout(r, 100));
    req.destroy();
    await closed;
  });

  it("le préfixe le PLUS LONG gagne, quel que soit l'ordre de montage", async () => {
    const court = await upstream((_q, res) => res.end("court"));
    const long = await upstream((_q, res) => res.end("long"));
    const proxy = proxyWith({ "/a/": { target: court.origin } });
    proxy.mount("/a/b/", { target: long.origin });
    const port = await front(proxy);
    expect((await get(port, "/a/b/c")).body).toBe("long");
    expect((await get(port, "/a/c")).body).toBe("court");
  });

  it("une cible calculée suit l'amont ; `undefined` = amont pas prêt (503)", async () => {
    const one = await upstream((_q, res) => res.end("un"));
    const two = await upstream((_q, res) => res.end("deux"));
    let current: string | undefined;
    const proxy = proxyWith({});
    proxy.mount("/svc/", { target: () => current });
    const p2 = await front(proxy);
    expect((await get(p2, "/svc/")).status).toBe(503);
    current = one.origin;
    expect((await get(p2, "/svc/")).body).toBe("un");
    current = two.origin;
    expect((await get(p2, "/svc/")).body).toBe("deux");
  });

  it("un socket amont gardé en pool ne retient pas la requête du client qui l'a ouvert", async () => {
    // Le délai d'ÉTABLISSEMENT s'arme sur un socket neuf par `once("connect")`
    // + `once("close")`. Si le second survit à la connexion, il reste sur le
    // socket mis en pool (keep-alive) et sa fermeture retient le relais entier
    // — requête et réponse du client, donc son socket et le dernier contexte
    // HTTP servi dessus — tant que l'amont garde la connexion. Vécu : gate
    // mémoire rouge sous Windows, « 2 contextes jamais réclamés » sur le GET
    // relayé, dès qu'un socket amont NEUF naissait pendant la boucle.
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const up = await upstream();
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    // La RÉPONSE compte autant que la requête : le noyau y attache son
    // écouteur `close`, dont la fermeture tient le contexte HTTP.
    // Porteur objet : une variable affectée dans la fermeture serait rétrécie
    // à `null` par le contrôle de flux de TypeScript.
    const seen: {
      client?: WeakRef<http.IncomingMessage>;
      reply?: WeakRef<http.ServerResponse>;
    } = {};
    const server = http.createServer((req, res) => {
      seen.client ??= new WeakRef(req);
      seen.reply ??= new WeakRef(res);
      void proxy.forward(req, res, "http");
    });
    const port = await listen(server);
    expect((await get(port, "/svc/")).body).toBe("amont");
    // Précondition : le socket amont est bien GARDÉ (sinon le vert ne prouve rien).
    const agent = proxy.mounts?.[0]?.agent;
    const pooled = Object.values(agent?.freeSockets ?? {}).flat();
    expect(pooled, "socket amont gardé en pool").toHaveLength(1);
    for (
      let i = 0;
      i < 5 && (seen.client?.deref() ?? seen.reply?.deref()) !== undefined;
      i++
    ) {
      await new Promise((r) => setImmediate(r));
      gc();
    }
    expect(
      seen.client?.deref(),
      "la requête du client est retenue par le socket amont en pool",
    ).toBeUndefined();
    expect(
      seen.reply?.deref(),
      "la réponse au client est retenue par le socket amont en pool",
    ).toBeUndefined();
  });

  it("unmount : le dernier retiré rend `mounts` à null (coût nul dans le pipeline)", () => {
    const proxy = proxyWith({ "/svc/": { target: "http://127.0.0.1:1" } });
    expect(proxy.mounts).not.toBeNull();
    proxy.unmount("svc");
    expect(proxy.mounts).toBeNull();
    expect(proxyWith({}).mounts).toBeNull();
  });
});

describe("ReverseProxy — front HTTP/2 vers amont HTTP/1.1", () => {
  let key = "";
  let cert = "";
  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    cert = await createSelfSignedCertificate({
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
    key = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  });

  it("rend la réponse amont malgré ses en-têtes de connexion (interdits en HTTP/2)", async () => {
    // Un serveur Node pose d'office `Connection: keep-alive` + `Keep-Alive`.
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("par h2");
    });
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    const server = http2.createSecureServer({ key, cert, allowHTTP1: true });
    server.on("request", (req, res) => {
      if (proxy.forward(req, res, "https") === undefined) {
        res.writeHead(404);
        res.end();
      }
    });
    const port = await listen(server);
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    closers.push(
      () => new Promise((resolve) => session.close(() => resolve())),
    );
    const answer = await new Promise<{
      status: number;
      body: string;
      headers: http2.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const stream = session.request({ ":path": "/svc/x", ":method": "GET" });
      let body = "";
      let status = 0;
      let headers: http2.IncomingHttpHeaders = {};
      stream.on("response", (h) => {
        status = Number(h[":status"]);
        headers = h;
      });
      stream.on("data", (c: Buffer) => (body += c.toString()));
      stream.on("end", () => resolve({ status, body, headers }));
      stream.on("error", reject);
      stream.end();
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("par h2");
    expect(answer.headers.connection).toBeUndefined();
    expect(answer.headers["keep-alive"]).toBeUndefined();
    // Aucun pseudo-en-tête HTTP/2 ne fuit vers l'amont HTTP/1.1.
    expect(
      Object.keys(up.seen[0]?.headers ?? {}).some((k) => k.startsWith(":")),
    ).toBe(false);
    expect(up.seen[0]?.headers["x-forwarded-proto"]).toBe("https");
  });
});

describe("ReverseProxy — upgrade WebSocket", () => {
  /** Amont WebSocket d'écho sur un serveur HTTP. */
  async function wsUpstream(): Promise<{
    origin: string;
    seen: http.IncomingHttpHeaders[];
  }> {
    const seen: http.IncomingHttpHeaders[] = [];
    const server = http.createServer((_q, res) => res.end());
    const wss = new WebSocketServer({
      server,
      handleProtocols: (p) => [...p][0] ?? false,
    });
    wss.on("connection", (ws, req) => {
      seen.push(req.headers);
      ws.on("message", (m) => ws.send(`écho:${(m as Buffer).toString()}`));
    });
    closers.push(
      () =>
        new Promise((resolve) => {
          for (const c of wss.clients) c.terminate();
          wss.close(() => resolve());
        }),
    );
    const port = await listen(server);
    return { origin: `http://127.0.0.1:${port}`, seen };
  }

  function open(
    port: number,
    path: string,
    protocol?: string,
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocol);
      closers.push(async () => ws.terminate());
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
  }

  it("relaie l'upgrade, le sous-protocole négocié et les messages dans les deux sens", async () => {
    const up = await wsUpstream();
    const port = await front(
      proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
    );
    const ws = await open(port, "/hmr/?token=abc", "vite-hmr");
    expect(ws.protocol).toBe("vite-hmr");
    const reply = new Promise<string>((resolve) =>
      ws.once("message", (m) => resolve((m as Buffer).toString())),
    );
    ws.send("salut");
    expect(await reply).toBe("écho:salut");
    expect(up.seen[0]?.host).toBe(new URL(up.origin).host);
    expect(up.seen[0]?.["x-forwarded-for"]).toBe("127.0.0.1");
  });

  it("sans `websocket: true`, l'upgrade n'est pas pris par le proxy", async () => {
    const up = await wsUpstream();
    const proxy = proxyWith({ "/hmr/": { target: up.origin } });
    const req = { url: "/hmr/", headers: {} } as http.IncomingMessage;
    expect(proxy.handleUpgrade(req, new net.Socket(), Buffer.alloc(0))).toBe(
      false,
    );
  });

  it("un refus de l'amont est rendu tel quel au client", async () => {
    const server = http.createServer();
    server.on("upgrade", (_req, socket: Duplex) => {
      // La socket d'un `upgrade` n'a AUCUN écouteur `error` (Node retire le
      // sien au passage) : sous Windows, le client coupe en RST, et le
      // `ECONNRESET` qui en sort devient une exception non rattrapée.
      socket.on("error", () => {});
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
    const port = await front(
      proxyWith({
        "/hmr/": {
          target: `http://127.0.0.1:${await listen(server)}`,
          websocket: true,
        },
      }),
    );
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 403");
  });

  it("amont injoignable → 502 sur l'upgrade", async () => {
    const port = await front(
      proxyWith({
        "/hmr/": {
          target: `http://127.0.0.1:${await deadPort()}`,
          websocket: true,
        },
      }),
    );
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 502");
  });

  it("quotas par IP du VRAI noyau appliqués au tunnel : 429 au-delà, place rendue à la fermeture", async () => {
    const up = await wsUpstream();
    const kernel = kernelWith({ wsMaxConnectionsPerIp: 1 });
    const proxy = withRules(
      proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
      { quota: kernel.websocketQuotaRefusal.bind(kernel) },
    );
    const port = await front(proxy);
    const first = await open(port, "/hmr/");
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 429");
    expect(up.seen).toHaveLength(1);
    await new Promise((resolve) => {
      first.once("close", resolve);
      first.close();
    });
    // La place se rend à la fermeture du socket CLIENT côté proxy.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(open(port, "/hmr/")).resolves.toBeInstanceOf(WebSocket);
  });

  it("débit de handshakes : même compteur que les requêtes HTTP (429 au-delà)", async () => {
    const up = await wsUpstream();
    const kernel = kernelWith({ rateMax: 1 });
    const proxy = withRules(
      proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
      { quota: kernel.websocketQuotaRefusal.bind(kernel) },
    );
    const port = await front(proxy);
    await open(port, "/hmr/");
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 429");
    expect(up.seen).toHaveLength(1);
  });

  it("`maxSockets` borne les tunnels, hors pool : 503 au-delà, place rendue à la fermeture", async () => {
    const up = await wsUpstream();
    const proxy = proxyWith(
      { "/hmr/": { target: up.origin, websocket: true } },
      30_000,
      5_000,
      1,
    );
    const port = await front(proxy);
    const first = await open(port, "/hmr/");
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 503");
    await new Promise((resolve) => {
      first.once("close", resolve);
      first.close();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(open(port, "/hmr/")).resolves.toBeInstanceOf(WebSocket);
  });

  it("amont qui accepte la connexion puis se tait : 504 au bout de `timeoutMs`", async () => {
    const held: Duplex[] = [];
    const server = http.createServer();
    server.on("upgrade", (_req, socket: Duplex) => {
      // La socket d'un `upgrade` n'a AUCUN écouteur `error` (Node retire le
      // sien au passage) : sous Windows, le client coupe en RST, et le
      // `ECONNRESET` qui en sort devient une exception non rattrapée.
      socket.on("error", () => {});
      held.push(socket);
    });
    const upstreamPort = await listen(server);
    // Après `listen` : les nettoyeurs partent en ordre inverse, et le serveur
    // attendrait à sa fermeture ces sockets détachés.
    closers.push(async () => {
      for (const s of held) s.destroy();
    });
    const port = await front(
      proxyWith({
        "/hmr/": {
          target: `http://127.0.0.1:${upstreamPort}`,
          websocket: true,
          timeoutMs: 200,
        },
      }),
    );
    const started = Date.now();
    await expect(open(port, "/hmr/")).rejects.toThrow("HTTP 504");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("un tunnel ÉTABLI survit au délai d'inactivité (il ne vaut que pour le handshake)", async () => {
    const up = await wsUpstream();
    const port = await front(
      proxyWith({
        "/hmr/": { target: up.origin, websocket: true, timeoutMs: 150 },
      }),
    );
    const ws = await open(port, "/hmr/");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const reply = new Promise<string>((resolve) =>
      ws.once("message", (m) => resolve((m as Buffer).toString())),
    );
    ws.send("encore là");
    expect(await reply).toBe("écho:encore là");
  });

  it("Host hors `trustedHosts` (domainCheck actif) → 421, rien n'est relayé", async () => {
    const up = await wsUpstream();
    const proxy = withRules(
      proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
      { host: (h) => h === "127.0.0.1", domainCheck: true },
    );
    const port = await front(proxy);
    await expect(open(port, "/hmr/")).resolves.toBeInstanceOf(WebSocket);
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/hmr/`, {
          headers: { host: "evil.example.test" },
        });
        closers.push(async () => ws.terminate());
        ws.once("open", resolve);
        ws.once("unexpected-response", (_q, res) =>
          reject(new Error(`HTTP ${res.statusCode}`)),
        );
        ws.once("error", reject);
      }),
    ).rejects.toThrow("HTTP 421");
    expect(up.seen).toHaveLength(1);
  });
});

describe("ReverseProxy — refus au montage", () => {
  const cases: [string, string, IProxyMountOptions][] = [
    ["préfixe « / »", "/", { target: "http://127.0.0.1:1" }],
    ["administration", "/nodefony/x/", { target: "http://127.0.0.1:1" }],
    ["segment ..", "/a/../b/", { target: "http://127.0.0.1:1" }],
    ["cible avec chemin", "/svc/", { target: "http://127.0.0.1:1/base" }],
    ["cible ftp", "/svc/", { target: "ftp://127.0.0.1" }],
    [
      "identifiants dans la cible",
      "/svc/",
      { target: "http://u:p@127.0.0.1:1" },
    ],
    [
      "secure:false hors boucle locale",
      "/svc/",
      { target: "https://api.example.test", secure: false },
    ],
    ["méthodes vides", "/svc/", { target: "http://127.0.0.1:1", methods: [] }],
    ["délai négatif", "/svc/", { target: "http://127.0.0.1:1", timeoutMs: -1 }],
  ];
  it.each(cases)("refuse : %s", (_label, prefix, options) => {
    expect(() => proxyWith({}).mount(prefix, options)).toThrow(/refusé/);
  });

  it("accepte `secure: false` vers la boucle locale, et `/_vite/` posé par un module", () => {
    const proxy = proxyWith({});
    proxy.mount("/svc/", { target: "https://127.0.0.1:8443", secure: false });
    proxy.mount("/_vite/default/", {
      target: () => undefined,
      websocket: true,
    });
    expect(proxy.mounts?.map((m) => m.prefix)).toEqual([
      "/_vite/default/",
      "/svc/",
    ]);
  });
});

/** Requête HTTP/1.1 BRUTE (cadrage et cible libres), réponse brute jusqu'à fermeture. */
function raw(port: number, text: string, waitMs = 1_500): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    socket.on("data", (c: Buffer) => (data += c.toString()));
    socket.on("error", reject);
    socket.on("close", () => resolve(data));
    socket.write(text);
    setTimeout(() => socket.destroy(), waitMs);
  });
}

describe("ReverseProxy — durcissement (relevé HAProxy/nginx/Envoy/Traefik + doc Node)", () => {
  it("pose `Via` sur la requête et la réponse (RFC 9110 §7.6.3)", async () => {
    const up = await upstream();
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    const port = await front(proxy);
    const r = await get(port, "/svc/", { headers: { via: "1.1 frontal" } });
    expect(up.seen[0]?.headers.via).toBe(`1.1 frontal, 1.1 ${proxy.pseudonym}`);
    expect(r.headers.via).toBe(`1.1 ${proxy.pseudonym}`);
    expect(proxy.pseudonym).toMatch(/^nodefony-[0-9a-f]{8}$/);
  });

  it("un message qui porte déjà notre `Via` est une boucle : 508, l'amont n'est pas contacté", async () => {
    const up = await upstream();
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    const port = await front(proxy);
    const r = await get(port, "/svc/", {
      headers: { via: `1.1 ${proxy.pseudonym}` },
    });
    expect(r.status).toBe(508);
    expect(up.seen).toHaveLength(0);
  });

  it(`\`Via\` de ${MAX_VIA_HOPS} sauts ou plus : boucle présumée, 508 sans contacter l'amont`, async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const chain = (n: number): string =>
      Array.from({ length: n }, (_, i) => `1.1 relais-${i}`).join(", ");
    expect(
      (await get(port, "/svc/", { headers: { via: chain(MAX_VIA_HOPS - 1) } }))
        .status,
    ).toBe(200);
    expect(
      (await get(port, "/svc/", { headers: { via: chain(MAX_VIA_HOPS) } }))
        .status,
    ).toBe(508);
    expect(up.seen).toHaveLength(1);
  });

  it("`Transfer-Encoding: gzip, chunked` : 501, jamais réétiqueté en chunked (RFC 9112 §6.1)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const text =
      "POST /svc/ HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip, chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n";
    expect(await raw(port, text, 500)).toMatch(/^HTTP\/1\.1 501/);
    expect(up.seen).toHaveLength(0);
  });

  it("après `closeAll` (arrêt), un relais en vol passe sans recréer de pool", async () => {
    const up = await upstream();
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    const port = await front(proxy);
    proxy.closeAll();
    expect((await get(port, "/svc/")).status).toBe(200);
    const mount = proxy.mounts?.[0] as unknown as
      { agent: unknown } | undefined;
    expect(mount).toBeDefined();
    expect(mount?.agent).toBe(null);
  });

  it.each([
    "/svc/a/../b",
    "/svc/./a",
    "/svc/..%2fadmin",
    "/svc/%2e%2e/x",
    "/svc/a%5cb",
    "/svc/a%00b",
    "/svc/%252e%252e/",
  ])("chemin ambigu %s : 400, jamais normalisé en silence", async (path) => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    expect((await get(port, path)).status).toBe(400);
    expect(up.seen).toHaveLength(0);
  });

  it("garde un `%20` et une requête encodée (chemins légitimes)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    expect((await get(port, "/svc/Mon%20Projet/a.ts?x=%2e%2e")).status).toBe(
      200,
    );
    expect(up.seen[0]?.url).toBe("/svc/Mon%20Projet/a.ts?x=%2e%2e");
  });

  it("cible absolute-form (`GET http://hôte/svc/…`) : jamais relayée (RFC 9112 §3.2.2)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await raw(
      port,
      "GET http://evil.example.test/svc/x HTTP/1.1\r\nHost: evil.example.test\r\nConnection: close\r\n\r\n",
    );
    expect(r).toContain("routage");
    expect(up.seen).toHaveLength(0);
  });

  it("GET avec `Content-Length` : le corps part avec, l'amont ne reste pas en attente (RFC 9112 §6.3)", async () => {
    const up = await upstream((req, res) =>
      res.end(`reçu:${req.headers["content-length"]}`),
    );
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await raw(
      port,
      "GET /svc/ HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
    );
    expect(r).toContain("reçu:5");
    expect(up.seen[0]?.body).toBe("hello");
  });

  it("DELETE en chunked : recadré en chunked vers l'amont, corps intact", async () => {
    const up = await upstream((req, res) =>
      res.end(`te:${req.headers["transfer-encoding"]}`),
    );
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await raw(
      port,
      "DELETE /svc/x HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    );
    expect(r).toContain("te:chunked");
    expect(up.seen[0]?.body).toBe("hello");
  });

  it("`Content-Length` ET `Transfer-Encoding` : refusé avant le proxy (pas de désynchronisation)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    const r = await raw(
      port,
      "POST /svc/ HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /svc/smuggled HTTP/1.1\r\nHost: x\r\n\r\n",
    );
    expect(r).toMatch(/^HTTP\/1\.1 400/);
    expect(up.seen.some((s) => s.url === "/svc/smuggled")).toBe(false);
  });

  it("`Expect: 100-continue` n'est pas transmis (le serveur a déjà répondu 100)", async () => {
    const up = await upstream();
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    await get(port, "/svc/", {
      method: "PUT",
      body: "x",
      headers: { expect: "100-continue", "content-length": 1 },
    });
    expect(up.seen[0]?.headers.expect).toBeUndefined();
    expect(up.seen[0]?.body).toBe("x");
  });

  it("`stripPrefix` ramène `Location` sous le préfixe ; un tiers reste intact", async () => {
    let location = "";
    const up = await upstream((_q, res) => {
      res.writeHead(302, { location });
      res.end();
    });
    const port = await front(
      proxyWith({ "/svc/": { target: up.origin, stripPrefix: true } }),
    );
    location = "/login?next=%2F";
    expect((await get(port, "/svc/")).headers.location).toBe(
      "/svc/login?next=%2F",
    );
    location = `${up.origin}/x`;
    expect((await get(port, "/svc/")).headers.location).toBe("/svc/x");
    location = "https://idp.example.test/auth";
    expect((await get(port, "/svc/")).headers.location).toBe(
      "https://idp.example.test/auth",
    );
  });

  it("amont coupé EN PLEIN CORPS : la réponse au client est interrompue, elle ne pend pas", async () => {
    const up = await upstream((_q, res) => {
      res.writeHead(200, { "content-length": 1000 });
      res.write("début");
      setTimeout(() => res.socket?.destroy(), 30);
    });
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    await expect(
      new Promise((resolve, reject) => {
        http
          .get(
            { host: "127.0.0.1", port, path: "/svc/", agent: false },
            (res) => {
              res.on("data", () => undefined);
              res.on("end", () => resolve("fin"));
              res.on("error", reject);
              res.on("aborted", () => reject(new Error("interrompu")));
            },
          )
          .on("error", reject);
      }),
    ).rejects.toThrow();
  });

  it("client parti EN PLEIN CORPS : l'échange amont est fermé", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    const up = await upstream((req, res) => {
      res.writeHead(200);
      const tick = setInterval(() => res.write("x".repeat(1024)), 10);
      req.socket.on("close", () => {
        clearInterval(tick);
        upstreamClosed();
      });
    });
    const port = await front(proxyWith({ "/svc/": { target: up.origin } }));
    await new Promise<void>((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/svc/", agent: false },
        (res) => {
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", () => undefined);
    });
    await closed;
  });

  it("connexion amont non établie à temps (TEST-NET-1, RFC 5737) : 504", async () => {
    const port = await front(
      proxyWith({ "/svc/": { target: "http://192.0.2.1:81" } }, 30_000, 200),
    );
    const r = await get(port, "/svc/");
    expect(r.status).toBe(504);
  });

  it("pool DÉDIÉ par montage, sans `proxyEnv` (NODE_USE_ENV_PROXY ignoré) ; fermé avec le montage", async () => {
    const up = await upstream();
    const proxy = proxyWith({ "/svc/": { target: up.origin } });
    const port = await front(proxy);
    await get(port, "/svc/");
    const first = proxy.mounts?.[0];
    expect(first).toBeDefined();
    const agent = (first as unknown as { agent: http.Agent }).agent;
    expect(agent).toBeInstanceOf(http.Agent);
    expect(agent).not.toBe(http.globalAgent);
    expect(
      (agent as unknown as { options: { proxyEnv?: unknown } }).options
        .proxyEnv,
    ).toBeUndefined();
    const pooled = Object.values(agent.freeSockets).flat();
    expect(pooled.length).toBeGreaterThan(0);
    proxy.unmount("/svc/");
    expect(pooled.every((socket) => socket?.destroyed === true)).toBe(true);
  });
});

describe("ReverseProxy — upgrade : contrôles avant relais", () => {
  async function wsEcho(): Promise<{ origin: string; count: () => number }> {
    let n = 0;
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
      n++;
      ws.on("message", (m) => ws.send(m));
    });
    closers.push(
      () =>
        new Promise((resolve) => {
          for (const c of wss.clients) c.terminate();
          wss.close(() => resolve());
        }),
    );
    const port = await listen(server);
    return { origin: `http://127.0.0.1:${port}`, count: () => n };
  }

  const key = "dGhlIHNhbXBsZSBub25jZQ==";

  it.each([
    [
      "Upgrade: h2c (tunnel non inspecté)",
      `GET /hmr/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: h2c\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
    ],
    [
      "version 8",
      `GET /hmr/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
    ],
    [
      "clé absente",
      "GET /hmr/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\r\n",
    ],
    [
      "chemin ambigu",
      `GET /hmr/..%2fx HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
    ],
  ])(
    "handshake non conforme (%s) : 400 (RFC 6455 §4.2.1)",
    async (_label, text) => {
      const up = await wsEcho();
      const port = await front(
        proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
      );
      expect(await raw(port, text, 500)).toMatch(/^HTTP\/1\.1 400/);
      expect(up.count()).toBe(0);
    },
  );

  it("`Origin` refusée par la règle du serveur WebSocket : 403 (anti-CSWSH, RFC 6455 §10.2)", async () => {
    const up = await wsEcho();
    const proxy = withRules(
      proxyWith({ "/hmr/": { target: up.origin, websocket: true } }),
      { origin: (o) => o === undefined || o === "http://127.0.0.1" },
    );
    const port = await front(proxy);
    const text = `GET /hmr/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nOrigin: https://evil.example.test\r\n\r\n`;
    expect(await raw(port, text, 500)).toMatch(/^HTTP\/1\.1 403/);
    expect(up.count()).toBe(0);
  });

  it("boucle (`Via` déjà porteur de notre pseudonyme) : 508", async () => {
    const up = await wsEcho();
    const proxy = proxyWith({
      "/hmr/": { target: up.origin, websocket: true },
    });
    const port = await front(proxy);
    const text = `GET /hmr/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nVia: 1.1 ${proxy.pseudonym}\r\n\r\n`;
    expect(await raw(port, text, 500)).toMatch(/^HTTP\/1\.1 508/);
    expect(up.count()).toBe(0);
  });

  it("refus de l'amont en chunked : recadré (pas de Transfer-Encoding recopié sur un corps décodé)", async () => {
    const server = http.createServer();
    server.on("upgrade", (_req, socket: Duplex) => {
      // La socket d'un `upgrade` n'a AUCUN écouteur `error` (Node retire le
      // sien au passage) : sous Windows, le client coupe en RST, et le
      // `ECONNRESET` qui en sort devient une exception non rattrapée.
      socket.on("error", () => {});
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n5\r\nnon !\r\n0\r\n\r\n",
      );
    });
    const port = await front(
      proxyWith({
        "/hmr/": {
          target: `http://127.0.0.1:${await listen(server)}`,
          websocket: true,
        },
      }),
    );
    const text = `GET /hmr/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`;
    const r = await raw(port, text, 500);
    expect(r).toMatch(/^HTTP\/1\.1 403/);
    expect(r.toLowerCase()).not.toContain("transfer-encoding");
    expect(r).toContain("Connection: close");
    expect(r.endsWith("non !")).toBe(true);
  });
});

describe("ReverseProxy — amont pas encore prêt (#577)", () => {
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  // Le montage que pose @nodefony/frontend, Vite pas encore prêt.
  const notReady = (): ReverseProxy => {
    const proxy = proxyWith({});
    proxy.mount("/_vite/default/", {
      target: () => undefined,
      websocket: true,
      methods: ["GET", "HEAD"],
    });
    return proxy;
  };

  it("upgrade : 503 AVANT tout 101, jamais laissé filer vers le routage", async () => {
    const port = await front(notReady());
    const answer = await raw(
      port,
      `GET /_vite/default/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Protocol: vite-ping\r\n\r\n`,
      500,
    );
    expect(answer).toMatch(/^HTTP\/1\.1 503 /);
  });

  it("GET : 503 + Retry-After au lieu du 404 du routage", async () => {
    const port = await front(notReady());
    const r = await get(port, "/_vite/default/@vite/client");
    expect(r.status).toBe(503);
    expect(r.headers["retry-after"]).toBe("1");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("une méthode non relayée suit toujours le routage, cible prête ou non", async () => {
    const port = await front(notReady());
    const r = await get(port, "/_vite/default/x", { method: "POST" });
    expect(r.body).toBe("routage");
  });
});

describe("HttpKernel.websocketUpgradeRefusal — refus avant le 101 (#577)", () => {
  const upgrade = (
    url: string,
    ip = "10.0.0.1",
    host = "x",
  ): http.IncomingMessage =>
    ({
      url,
      headers: { host },
      socket: { remoteAddress: ip },
    }) as unknown as http.IncomingMessage;
  const withRouter = (
    kernel: HttpKernel,
    served: (pathname: string) => boolean,
  ): string[] => {
    const seen: string[] = [];
    kernel.router = {
      servesWebsocket: (pathname: string) => {
        seen.push(pathname);
        return served(pathname);
      },
    } as unknown as HttpKernel["router"];
    return seen;
  };

  it("routeur pas encore posé (boot) : 503", () => {
    expect(kernelWith({}).websocketUpgradeRefusal(upgrade("/ws"))).toBe(503);
  });

  it("chemin sans route WebSocket : 404 ; avec : admis", () => {
    const kernel = kernelWith({});
    withRouter(kernel, (p) => p === "/ws");
    expect(kernel.websocketUpgradeRefusal(upgrade("/ws?x=1"))).toBe(null);
    expect(kernel.websocketUpgradeRefusal(upgrade("/inconnu"))).toBe(404);
  });

  it("le routeur reçoit le chemin WHATWG que lira le contexte (`//a` reste un chemin)", () => {
    const kernel = kernelWith({});
    const seen = withRouter(kernel, () => true);
    kernel.websocketUpgradeRefusal(upgrade("//a/./b/../c?q"));
    expect(seen).toEqual(["//a/c"]);
  });

  it("URL inanalysable : 400", () => {
    const kernel = kernelWith({});
    withRouter(kernel, () => true);
    expect(
      kernel.websocketUpgradeRefusal(upgrade("/ws", "10.0.0.1", "a b")),
    ).toBe(400);
  });

  it("un refus compte au limiteur de débit : 404 puis 429", () => {
    const kernel = kernelWith({ rateMax: 1 });
    withRouter(kernel, () => false);
    expect(kernel.websocketUpgradeRefusal(upgrade("/x"))).toBe(404);
    expect(kernel.websocketUpgradeRefusal(upgrade("/x"))).toBe(429);
    expect(kernel.websocketUpgradeRefusal(upgrade("/x", "10.0.0.2"))).toBe(404);
  });

  it("un upgrade admis n'est pas compté ici (il l'est après l'ouverture, une seule fois)", () => {
    const kernel = kernelWith({ rateMax: 1 });
    withRouter(kernel, () => true);
    expect(kernel.websocketUpgradeRefusal(upgrade("/ws"))).toBe(null);
    expect(kernel.websocketUpgradeRefusal(upgrade("/ws"))).toBe(null);
    expect(
      kernel.websocketQuotaRefusal(upgrade("/ws"), new EventEmitter()),
    ).toBe(null);
  });
});

describe("HttpKernel.websocketQuotaRefusal — règle unique des quotas WebSocket", () => {
  const req = (ip: string): http.IncomingMessage =>
    ({ headers: {}, socket: { remoteAddress: ip } }) as http.IncomingMessage;

  it("tout désarmé (défaut) : admis, rien n'est compté ni écouté", () => {
    const kernel = kernelWith({});
    const connection = new EventEmitter();
    expect(kernel.websocketQuotaRefusal(req("10.0.0.1"), connection)).toBe(
      null,
    );
    expect(connection.listenerCount("close")).toBe(0);
  });

  it("connexions simultanées : refus au plafond, place rendue à la fermeture, IP par IP", () => {
    const kernel = kernelWith({ wsMaxConnectionsPerIp: 1 });
    const first = new EventEmitter();
    expect(kernel.websocketQuotaRefusal(req("10.0.0.1"), first)).toBe(null);
    expect(
      kernel.websocketQuotaRefusal(req("10.0.0.1"), new EventEmitter()),
    ).toBe("too many connections");
    expect(
      kernel.websocketQuotaRefusal(req("10.0.0.2"), new EventEmitter()),
    ).toBe(null);
    first.emit("close");
    expect(
      kernel.websocketQuotaRefusal(req("10.0.0.1"), new EventEmitter()),
    ).toBe(null);
  });

  it("débit : le compteur des requêtes HTTP refuse au-delà de `max`", () => {
    const kernel = kernelWith({ rateMax: 2 });
    const hit = (): string | null =>
      kernel.websocketQuotaRefusal(req("10.0.0.1"), new EventEmitter());
    expect([hit(), hit(), hit()]).toEqual([null, null, "rate limit"]);
  });
});
