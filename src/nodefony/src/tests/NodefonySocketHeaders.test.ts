import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";

/**
 * `NodefonySocketOptions.headers` : sous Node, la poignée de main porte les
 * en-têtes demandés (une session par cookie), et la sonde d'échec aussi ; un
 * `WebSocket` qui n'en prend pas (navigateur) fait échouer l'ouverture en le
 * disant. Le serveur est un `node:http` nu qui REFUSE tout en 401 : on lit ce
 * qu'il a reçu, sans dépendre d'un serveur temps réel.
 */
describe("NodefonySocket — en-têtes de la poignée de main", () => {
  let server: Server | null = null;

  afterEach(() => {
    vi.unstubAllGlobals();
    server?.close();
    server = null;
  });

  /** Un serveur qui retient les en-têtes reçus, poignée de main et sonde. */
  async function refusingServer(): Promise<{
    url: string;
    upgrades: IncomingHttpHeaders[];
    probes: IncomingHttpHeaders[];
  }> {
    const upgrades: IncomingHttpHeaders[] = [];
    const probes: IncomingHttpHeaders[] = [];
    const s = createServer((req, res) => {
      probes.push(req.headers);
      res.writeHead(401).end();
    });
    s.on("upgrade", (req, socket) => {
      upgrades.push(req.headers);
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    server = s;
    const address = s.address();
    if (address === null || typeof address === "string")
      throw new Error("adresse d'écoute introuvable");
    return {
      url: `http://127.0.0.1:${address.port}/realtime`,
      upgrades,
      probes,
    };
  }

  it("🔴 sous Node, le cookie part avec la poignée de main ET avec la sonde ; le refus est définitif", async () => {
    const { url, upgrades, probes } = await refusingServer();
    const socket = new NodefonySocket({
      url,
      headers: { cookie: "nodefony-session=abc" },
      autoReconnect: false,
      banner: false,
    });
    await expect(socket.connect()).rejects.toThrow(/avant ouverture/u);
    await vi.waitFor(() => expect(socket.state).toBe("error"));
    // Chaque tentative d'ouverture porte le cookie, et la sonde aussi.
    expect(upgrades.length).toBeGreaterThan(0);
    expect(new Set(upgrades.map((h) => h.cookie))).toEqual(
      new Set(["nodefony-session=abc"]),
    );
    expect(probes.map((h) => h.cookie)).toEqual(["nodefony-session=abc"]);
  });

  it("sans `headers`, la poignée de main part sans cookie (le comportement d'avant)", async () => {
    const { url, upgrades } = await refusingServer();
    const socket = new NodefonySocket({
      url,
      autoReconnect: false,
      banner: false,
      probe: false,
    });
    await expect(socket.connect()).rejects.toThrow();
    expect(upgrades.length).toBeGreaterThan(0);
    expect(upgrades.every((h) => h.cookie === undefined)).toBe(true);
  });

  it("🔴 un WebSocket qui refuse les en-têtes (navigateur) : l'ouverture échoue en le disant, sans retenter", async () => {
    /** Le constructeur d'un navigateur : un objet en second argument est un sous-protocole invalide. */
    class BrowserLikeWebSocket {
      constructor(_url: string, protocols?: unknown) {
        if (typeof protocols === "object" && !Array.isArray(protocols))
          throw new SyntaxError("invalid subprotocol");
      }
    }
    vi.stubGlobal("WebSocket", BrowserLikeWebSocket);
    const socket = new NodefonySocket({
      url: "http://127.0.0.1:1/realtime",
      headers: { cookie: "x=1" },
      autoReconnect: true,
      banner: false,
    });
    await expect(socket.connect()).rejects.toThrow(/ne sert que sous Node/u);
    expect(socket.state).toBe("error");
  });
});
