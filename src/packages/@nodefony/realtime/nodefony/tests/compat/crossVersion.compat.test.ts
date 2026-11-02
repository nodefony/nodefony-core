import "reflect-metadata";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import type { ContextType } from "@nodefony/http";
import { RpcError as CurrentServerRpcError } from "nodefony";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { serverSocket } from "../../src/server/ServerRealtimeSocket.js";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController.js";
// Client COURANT en source : c'est le code que le navigateur exécutera après la mise à jour.
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import {
  LoopbackClientTransport,
  LoopbackWire,
  loopbackServerContext,
} from "../helpers/loopback.js";

/**
 * Compatibilité ENTRE VERSIONS de la socket (#629, ADR-0022 §10) — lancé par
 * `npm run release:compat`, jamais par `npm test` : il lui faut la version
 * PUBLIÉE, installée par le script dans `NF_COMPAT_DIR`.
 *
 * Un onglet ouvert garde son code pendant des heures : après une mise à jour
 * du serveur, l'ANCIEN client parle au NOUVEAU serveur ; pendant un
 * déploiement progressif, le NOUVEAU client peut tomber sur un ANCIEN pod. Les
 * deux sens se jouent ici sur le câble en boucle, avec les mêmes scénarios.
 *
 * Une erreur se reconnaît à sa FORME (`code`, `data`), jamais par
 * `instanceof` : deux versions ont deux classes `RpcError`.
 */

const compatDir = process.env.NF_COMPAT_DIR;
const compatVersion = process.env.NF_COMPAT_VERSION ?? "?";
if (!compatDir)
  throw new Error(
    "NF_COMPAT_DIR absent — ce banc se lance par `npm run release:compat`, qui installe la version publiée.",
  );

/** Les modules PUBLIÉS, tels que `entry.mjs` (écrit par le script) les réexporte. */
interface IPublishedEntry {
  realtime: {
    RealtimeController: typeof RealtimeController;
    getRealtimeHub: typeof getRealtimeHub;
    serverSocket: typeof serverSocket;
  };
  client: { NodefonySocket: typeof NodefonySocket };
  ServerRpcError: typeof CurrentServerRpcError;
}

// La version publiée est lue avec les types de la version courante : c'est
// précisément l'hypothèse que ce banc éprouve à l'exécution.
const published = (await import(
  pathToFileURL(path.join(compatDir, "entry.mjs")).href
)) as IPublishedEntry;

/** Un serveur réel : sa classe de controller, son hub, sa classe d'erreur. */
interface IServerSide {
  Controller: typeof RealtimeController;
  hub: typeof getRealtimeHub;
  serverSocket: typeof serverSocket;
  RpcError: typeof CurrentServerRpcError;
}

const CURRENT_SERVER: IServerSide = {
  Controller: RealtimeController,
  hub: getRealtimeHub,
  serverSocket,
  RpcError: CurrentServerRpcError,
};
const PUBLISHED_SERVER: IServerSide = {
  Controller: published.realtime.RealtimeController,
  hub: published.realtime.getRealtimeHub,
  serverSocket: published.realtime.serverSocket,
  RpcError: published.ServerRpcError,
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Code d'une erreur JSON-RPC lu par sa forme. */
function rpcCode(e: unknown): number | null {
  return typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof e.code === "number"
    ? e.code
    : null;
}

/** Charge `data` d'une erreur JSON-RPC lue par sa forme. */
function rpcData(e: unknown): unknown {
  return typeof e === "object" && e !== null && "data" in e
    ? e.data
    : undefined;
}

/** Monte un serveur de la version donnée, relié à un client de la version donnée. */
async function connect(
  server: IServerSide,
  Socket: typeof NodefonySocket,
): Promise<{
  client: NodefonySocket;
  callClient: (method: string, params?: unknown) => Promise<unknown>;
}> {
  const { Controller, RpcError } = server;
  class CompatRt extends Controller {
    constructor(ctx: ContextType) {
      super("compat-rt", ctx);
    }
    protected override realtimeActions() {
      return {
        "nodefony:kernel:ping": () => ({
          pong: true,
          ts: 1,
          uptime: 1,
          pid: 1,
        }),
        "fail:rpc": () => {
          throw new RpcError("not found /x", -32000, { status: 404 });
        },
        "fail:opaque": () => {
          throw new Error("secret interne");
        },
      };
    }
    protected override realtimeChannels(): string[] {
      return ["compat:feed"];
    }
    override createRealtimeChannel(
      _channel: string,
      _publish: RealtimePublish,
    ): (() => void) | null {
      return () => undefined;
    }
    protected override realtimeInbound(): Record<
      string,
      RealtimeInboundHandler
    > {
      return { "compat:in": (params, reply) => reply({ echo: params }) };
    }
    feed(raw: string | Uint8Array | null): void {
      this.handleRealtime(raw);
    }
    callClient(method: string, params?: unknown): Promise<unknown> {
      return this.requestClient(method as never, params, 2000);
    }
  }
  const wire = new LoopbackWire();
  const rt = new CompatRt(loopbackServerContext(wire).ctx);
  wire.feedServer = (raw) => rt.feed(raw);
  const transport = new LoopbackClientTransport(wire);
  const client = new Socket(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return { client, callClient: (m, p) => rt.callClient(m, p) };
}

/** Les scénarios de compatibilité, joués dans un sens donné. */
function describeCrossVersion(
  label: string,
  server: IServerSide,
  Socket: typeof NodefonySocket,
): void {
  describe(label, () => {
    beforeEach(() => {
      getRealtimeHub().clear();
      published.realtime.getRealtimeHub().clear();
    });

    it("accueil : identité anonyme et méthodes annoncées", async () => {
      const { client } = await connect(server, Socket);
      expect(client.identity?.type).to.equal("anonymous");
      expect(client.serverMethods).to.include("nodefony:kernel:ping");
      client.disconnect();
    });

    it("requête client→serveur : résultat reçu", async () => {
      const { client } = await connect(server, Socket);
      const res = await client.request("nodefony:kernel:ping");
      expect(res).to.deep.include({ pong: true });
      client.disconnect();
    });

    it("erreur applicative : code et data fidèles, lus par leur forme", async () => {
      const { client } = await connect(server, Socket);
      const err = await client.request("fail:rpc").then(
        () => null,
        (e: unknown) => e,
      );
      expect(rpcCode(err)).to.equal(-32000);
      expect(rpcData(err)).to.deep.equal({ status: 404 });
      client.disconnect();
    });

    it("erreur opaque : -32603, sans fuite du message interne", async () => {
      const { client } = await connect(server, Socket);
      const err = await client.request("fail:opaque").then(
        () => null,
        (e: unknown) => e,
      );
      expect(rpcCode(err)).to.equal(-32603);
      expect(String(err)).not.to.contain("secret interne");
      client.disconnect();
    });

    it("méthode inconnue : -32601", async () => {
      const { client } = await connect(server, Socket);
      const err = await client.request("does:not:exist").then(
        () => null,
        (e: unknown) => e,
      );
      expect(rpcCode(err)).to.equal(-32601);
      client.disconnect();
    });

    it("abonnement : une publication serveur arrive au client", async () => {
      const { client } = await connect(server, Socket);
      const got: unknown[] = [];
      client.on("compat:feed", (p) => got.push(p));
      client.subscribe("compat:feed");
      await flush();
      server.serverSocket().publish("compat:feed", { tick: 1 });
      await flush();
      expect(got).to.deep.equal([{ tick: 1 }]);
      client.disconnect();
    });

    it("publication client sur un canal entrant : la réponse serveur revient", async () => {
      const { client } = await connect(server, Socket);
      const got: unknown[] = [];
      client.on("compat:in", (p) => got.push(p));
      client.publish("compat:in", { n: 1 });
      await flush();
      await flush();
      expect(got).to.deep.equal([{ echo: { n: 1 } }]);
      client.disconnect();
    });

    it("requête serveur→client : le résultat du handler client revient", async () => {
      const { client, callClient } = await connect(server, Socket);
      client.register("client:confirm", (params) => ({ ack: true, params }));
      expect(await callClient("client:confirm", { n: 7 })).to.deep.equal({
        ack: true,
        params: { n: 7 },
      });
      client.disconnect();
    });
  });
}

describe(`Compatibilité entre versions — publiée ${compatVersion} ↔ courante`, () => {
  describeCrossVersion(
    `client PUBLIÉ (${compatVersion}) → serveur COURANT`,
    CURRENT_SERVER,
    published.client.NodefonySocket,
  );
  describeCrossVersion(
    `client COURANT → serveur PUBLIÉ (${compatVersion})`,
    PUBLISHED_SERVER,
    NodefonySocket,
  );
});
