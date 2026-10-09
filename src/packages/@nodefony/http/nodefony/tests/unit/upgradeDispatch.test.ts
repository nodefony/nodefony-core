/// <reference types="node" />
/**
 * Répartiteur d'upgrade : un refus se rend par un statut HTTP AVANT le `101`
 * (RFC 6455 §4.2.2), jamais par une ouverture suivie d'une fermeture (#577).
 * Sockets réelles : c'est le client qui dit s'il a vu une ouverture.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { attachUpgradeDispatch } from "../../src/servers/upgradeDispatch";

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
