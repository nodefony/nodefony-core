/// <reference types="node" />
/**
 * Arrêt gracieux des serveurs (#570) : ce que voit un CLIENT quand le pod
 * s'arrête. En HTTP/2, chaque session reçoit un GOAWAY — les flux en vol se
 * terminent, le client sait qu'il doit rouvrir ailleurs — et seul ce qui reste à
 * l'échéance est détruit. En HTTP/1.1, la réponse en vol part avec
 * `Connection: close` et la socket inactive se ferme sans attendre.
 * Sockets réelles : c'est le client qui dit s'il a vu un GOAWAY ou une coupure.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  createDrainTerminator,
  type IDrainTerminator,
} from "../../service/servers/serverShutdown";
import { createSelfSignedCertificate } from "../../service/x509";

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

const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/** `h2c` = HTTP/2 en clair ; `h2` = HTTP/2 sur TLS, HTTP/1.1 admis (5152). */
type Kind = "h1" | "h2c" | "h2";
type Handler = (
  req: http.IncomingMessage | http2.Http2ServerRequest,
  res: http.ServerResponse | http2.Http2ServerResponse,
) => void;

async function serve(
  kind: Kind,
  handler: Handler,
  shutdownTimeout = 5000,
): Promise<{ origin: string; terminator: IDrainTerminator }> {
  const server =
    kind === "h1"
      ? http.createServer()
      : kind === "h2c"
        ? http2.createServer()
        : http2.createSecureServer({ key, cert, allowHTTP1: true });
  server.on("request", handler);
  const terminator = createDrainTerminator(server, shutdownTimeout);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return {
    origin: `${kind === "h2" ? "https" : "http"}://127.0.0.1:${port}`,
    terminator,
  };
}

/** Une porte : le handler attend `release()` pour répondre. */
function gate(): {
  wait: Promise<void>;
  release: () => void;
  entered: Promise<void>;
  enter: () => void;
} {
  let release = (): void => {};
  let enter = (): void => {};
  const wait = new Promise<void>((r) => (release = r));
  const entered = new Promise<void>((r) => (enter = r));
  return { wait, release, entered, enter };
}

function connect(
  kind: "h2c" | "h2",
  origin: string,
): { session: http2.ClientHttp2Session; goaway: () => boolean } {
  const session = http2.connect(
    origin,
    kind === "h2" ? { rejectUnauthorized: false } : {},
  );
  session.on("error", () => {});
  let goaway = false;
  session.on("goaway", () => (goaway = true));
  closers.push(() => {
    session.destroy();
  });
  return { session, goaway: () => goaway };
}

/** GET h2 : statut + corps, ou rejet si le flux se ferme sans fin. */
function get(
  session: http2.ClientHttp2Session,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const stream = session.request({ ":path": "/" });
    let status = 0;
    let body = "";
    stream.setEncoding("utf8");
    stream.on("response", (h) => (status = Number(h[":status"])));
    stream.on("data", (c: string) => (body += c));
    // Un flux coupé avec sa session émet `end` sans avoir reçu de réponse.
    stream.on("end", () =>
      status === 0
        ? reject(new Error("flux terminé sans réponse"))
        : resolve({ status, body }),
    );
    stream.on("error", reject);
    stream.on("close", () =>
      reject(new Error(`flux fermé sans fin (rstCode ${stream.rstCode})`)),
    );
    stream.end();
  });
}

/** GET HTTP/1.1 sur un agent keep-alive : statut, `Connection`, corps. */
function get1(
  origin: string,
  agent: http.Agent,
): Promise<{ status: number; connection: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = origin.startsWith("https") ? https : http;
    const req = lib.request(`${origin}/`, { agent }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          connection: res.headers.connection,
          body,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

function agentFor(origin: string): http.Agent {
  const agent = origin.startsWith("https")
    ? new https.Agent({ keepAlive: true, rejectUnauthorized: false })
    : new http.Agent({ keepAlive: true });
  closers.push(() => agent.destroy());
  return agent;
}

async function until(test: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error("condition jamais atteinte");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe.each(["h2c", "h2"] as const)("drain HTTP/2 — %s", (kind) => {
  it("une requête en vol est servie jusqu'au bout, APRÈS que le client a reçu GOAWAY", async () => {
    const g = gate();
    const srv = await serve(kind, (_req, res) => {
      g.enter();
      void g.wait.then(() => res.end("servie"));
    });
    const client = connect(kind, srv.origin);
    const pending = get(client.session);
    await g.entered;
    const stopped = srv.terminator.terminate();
    await until(() => client.goaway());
    g.release();
    expect(await pending).toEqual({ status: 200, body: "servie" });
    await stopped;
  });

  it("une session inactive reçoit GOAWAY et l'arrêt n'attend pas l'échéance", async () => {
    const srv = await serve(kind, (_req, res) => res.end("ok"), 3000);
    const client = connect(kind, srv.origin);
    expect((await get(client.session)).status).toBe(200);
    const t0 = performance.now();
    await srv.terminator.terminate();
    expect(performance.now() - t0).toBeLessThan(1000);
    await until(() => client.goaway());
  });

  it("un flux qui ne répond jamais est détruit à l'échéance, pas avant", async () => {
    const g = gate();
    const srv = await serve(kind, () => g.enter(), 300);
    const client = connect(kind, srv.origin);
    const pending = get(client.session).then(
      () => "fini",
      () => "coupé",
    );
    await g.entered;
    const t0 = performance.now();
    await srv.terminator.terminate();
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2000);
    expect(await pending).toBe("coupé");
  });
});

describe.each(["h1", "h2"] as const)("drain HTTP/1.1 — serveur %s", (kind) => {
  it("la réponse en vol part avec `Connection: close`", async () => {
    const g = gate();
    const srv = await serve(kind, (_req, res) => {
      g.enter();
      void g.wait.then(() => res.end("servie"));
    });
    const pending = get1(srv.origin, agentFor(srv.origin));
    await g.entered;
    const t0 = performance.now();
    const stopped = srv.terminator.terminate();
    g.release();
    expect(await pending).toEqual({
      status: 200,
      connection: "close",
      body: "servie",
    });
    await stopped;
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("une socket keep-alive inactive est fermée sans attendre l'échéance", async () => {
    const srv = await serve(kind, (_req, res) => res.end("ok"), 3000);
    const agent = agentFor(srv.origin);
    expect((await get1(srv.origin, agent)).status).toBe(200);
    const t0 = performance.now();
    await srv.terminator.terminate();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
