/// <reference types="node" />
/**
 * Répartiteur d'upgrade : un refus se rend par un statut HTTP AVANT le `101`
 * (RFC 6455 §4.2.2), jamais par une ouverture suivie d'une fermeture (#577).
 * Sockets réelles : c'est le client qui dit s'il a vu une ouverture.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import {
  attachUpgradeDispatch,
  type UpgradeAdmit,
} from "../../src/servers/upgradeDispatch";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function serve(refusal: (url: string) => number | null): Promise<{
  port: number;
  connections: () => number;
}> {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let connections = 0;
  wss.on("connection", (ws) => {
    connections++;
    ws.on("message", (m) => ws.send(m));
  });
  const detach = attachUpgradeDispatch(
    server,
    wss,
    () => null,
    (req) => refusal(req.url ?? "/"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        detach();
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  );
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
  };
}

/** Issue d'une ouverture vue par le client : `open` ou le statut HTTP reçu. */
function attempt(port: number, path: string): Promise<"open" | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, "vite-ping");
    closers.push(async () => ws.terminate());
    ws.once("open", () => resolve("open"));
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", reject);
  });
}

describe("attachUpgradeDispatch — refus avant le 101", () => {
  it("un refus rend son statut HTTP : le client ne voit jamais d'ouverture", async () => {
    const srv = await serve((url) => (url === "/ok" ? null : 404));
    expect(await attempt(srv.port, "/inconnu")).toBe(404);
    expect(srv.connections()).toBe(0);
  });

  it("un upgrade admis est confié au serveur WebSocket", async () => {
    const srv = await serve((url) => (url === "/ok" ? null : 404));
    expect(await attempt(srv.port, "/ok")).toBe("open");
    expect(srv.connections()).toBe(1);
  });

  it.each([400, 429, 503])("statut %i rendu tel quel", async (status) => {
    const srv = await serve(() => status);
    expect(await attempt(srv.port, "/x")).toBe(status);
    expect(srv.connections()).toBe(0);
  });
});

/**
 * #596 — l'admission ASYNCHRONE : le noyau décide (pare-feu, garde de l'action)
 * PENDANT que le client attend, puis accepte ou refuse. Rien ne doit s'ouvrir
 * avant le verdict, et la fenêtre d'attente ne doit ni fuir ni faire tomber le
 * process quand le client part.
 */
async function serveAdmit(admit: UpgradeAdmit): Promise<{
  port: number;
  connections: () => number;
}> {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let connections = 0;
  wss.on("connection", () => connections++);
  const detach = attachUpgradeDispatch(
    server,
    wss,
    () => null,
    () => null,
    admit,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        detach();
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  );
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
  };
}

/** Statut + en-têtes d'un handshake refusé, ou `open`. */
function attemptFull(
  port: number,
): Promise<"open" | { status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/x`);
    closers.push(async () => ws.terminate());
    ws.once("open", () => resolve("open"));
    ws.once("unexpected-response", (_req, res) =>
      resolve({ status: res.statusCode ?? 0, headers: res.headers }),
    );
    ws.once("error", reject);
  });
}

/** Ouvre un socket brut et envoie un handshake ; rend le socket. */
function rawUpgrade(
  port: number,
  key = "dGhlIHNhbXBsZSBub25jZQ==",
): Promise<net.Socket> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET /x HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
      );
      resolve(socket);
    });
    socket.on("error", () => {});
    closers.push(async () => {
      socket.destroy();
    });
  });
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("attachUpgradeDispatch — admission asynchrone (#596)", () => {
  it("un refus décidé après une attente rend son statut et ses en-têtes, sans ouverture", async () => {
    const srv = await serveAdmit((_req, admission) => {
      setTimeout(
        () =>
          admission.refuse(401, { "WWW-Authenticate": 'Bearer realm="zone"' }),
        30,
      );
    });
    const outcome = await attemptFull(srv.port);
    expect(outcome).not.toBe("open");
    if (outcome === "open") return;
    expect(outcome.status).toBe(401);
    expect(outcome.headers["www-authenticate"]).toBe('Bearer realm="zone"');
    expect(srv.connections()).toBe(0);
  });

  it("une acceptation décidée après une attente ouvre la socket", async () => {
    let accepted: unknown = undefined;
    const srv = await serveAdmit((_req, admission) => {
      setTimeout(() => {
        void Promise.resolve(admission.accept()).then((ws) => (accepted = ws));
      }, 30);
    });
    expect(await attemptFull(srv.port)).toBe("open");
    expect(accepted).toBeInstanceOf(WebSocket);
  });

  it("un handshake malformé reçoit 400 sans jamais atteindre le noyau", async () => {
    let admitted = 0;
    const srv = await serveAdmit(() => admitted++);
    const socket = await rawUpgrade(srv.port, "pas-une-cle");
    const reply = await new Promise<string>((resolve) =>
      socket.once("data", (d: Buffer) => resolve(String(d))),
    );
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(admitted).toBe(0);
  });

  // RFC 9113 §3.1 a RETIRÉ la bascule `Upgrade: h2c`. L'accepter ouvrirait la
  // contrebande h2c : un proxy frontal qui relaie l'`Upgrade` sans le
  // comprendre perd la vue sur tout ce qui suit, contrôles d'accès compris.
  // Le pire cas est un chemin qui POSSÈDE une route WebSocket (`refusal` rend
  // `null`) : seule la forme du handshake peut encore refuser.
  it("ATTAQUE contrebande h2c : `Upgrade: h2c` reçoit 400, jamais de 101 ni de trame HTTP/2", async () => {
    let admitted = 0;
    const srv = await serveAdmit(() => admitted++);
    const socket = await new Promise<net.Socket>((resolve) => {
      const s = net.connect(srv.port, "127.0.0.1", () => {
        s.write(
          `GET /x HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\n` +
            `Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\n` +
            `HTTP2-Settings: AAMAAABkAAQAAP__\r\n\r\n`,
        );
        resolve(s);
      });
      s.on("error", () => {});
      closers.push(async () => {
        s.destroy();
      });
    });
    const reply = await new Promise<string>((resolve) =>
      socket.once("data", (d: Buffer) => resolve(String(d))),
    );
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(reply).not.toMatch(/101 Switching Protocols/);
    expect(admitted).toBe(0);
  });

  it.each([
    ["ferme proprement", (s: net.Socket) => s.end()],
    ["coupe brutalement (RST)", (s: net.Socket) => s.resetAndDestroy()],
  ])(
    "un client qui %s pendant la décision : accept() rend null, rien ne s'ouvre",
    async (_label, leave) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      let verdict: unknown = "pending";
      const srv = await serveAdmit((_req, admission) => {
        void gate.then(() => admission.accept()).then((ws) => (verdict = ws));
      });
      const socket = await rawUpgrade(srv.port);
      await tick();
      leave(socket);
      await tick(50);
      release();
      await tick(50);
      expect(verdict).toBe(null);
      expect(srv.connections()).toBe(0);
    },
  );

  it("un en-tête de refus porteur d'un saut de ligne n'est jamais écrit (injection)", async () => {
    const srv = await serveAdmit((_req, admission) =>
      admission.refuse(401, {
        "X-Bad": "a\r\nSet-Cookie: pwn=1",
        "WWW-Authenticate": "Basic",
      }),
    );
    const outcome = await attemptFull(srv.port);
    if (outcome === "open") expect.fail("ouvert");
    expect(outcome.status).toBe(401);
    expect(outcome.headers["set-cookie"]).toBeUndefined();
    expect(outcome.headers["x-bad"]).toBeUndefined();
    expect(outcome.headers["www-authenticate"]).toBe("Basic");
  });

  it("ws répond tout de suite : accept() rend la socket SANS promesse (chemin de chaque connexion)", async () => {
    let direct: unknown = "pas appelé";
    const srv = await serveAdmit((_req, admission) => {
      direct = admission.accept();
    });
    expect(await attemptFull(srv.port)).toBe("open");
    expect(direct).toBeInstanceOf(WebSocket);
    expect(direct).not.toBeInstanceOf(Promise);
  });

  it("le verdict ne se rend qu'une fois : un refus après acceptation est ignoré", async () => {
    const srv = await serveAdmit((_req, admission) => {
      void admission.accept();
      admission.refuse(500);
    });
    expect(await attemptFull(srv.port)).toBe("open");
  });
});
