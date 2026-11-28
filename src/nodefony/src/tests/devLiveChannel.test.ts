import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  DEV_CHANNEL,
  DEV_CHILD_ENV,
  isCommandExecuteParams,
  isDevChannelMessage,
  LIVE_COMMAND_TIMEOUT_MS,
  LIVE_RESULT_TOO_LARGE,
  MAX_LIVE_REQUEST_BYTES,
  MAX_LIVE_RESULT_BYTES,
  NOT_LIVE,
  sendRpcToServer,
  sendRpcToSupervisor,
  type CommandExecuteResult,
  type DevChannelMessage,
} from "../service/dev/devChannel";
import { ServerPeer } from "../service/dev/serverPeer";
import { routeServerMessages } from "../service/dev/DevSupervisor";
import {
  SupervisorLink,
  type LiveCommandExecutor,
} from "../kernel/supervisorLink";
import {
  host,
  ServerChild,
  ServerEndpoint,
  until,
  wireLive,
} from "./devLiveFakes";
import { JsonRpcError } from "../jsonrpc/index";
import type { IRpcCall } from "../realtime/JsonRpcPeer";

/** Les deux bouts reliés, le pair du superviseur nu (`ServerPeer`). */
function wire(execute: LiveCommandExecutor) {
  return wireLive(execute, (child, onError) => new ServerPeer(child, onError));
}

const PARAMS = { command: "env", arguments: [], columns: 120 } as const;

const TEXT: CommandExecuteResult = {
  live: true,
  code: 0,
  parts: [{ text: "Environnement : development\n" }],
};

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[DEV_CHILD_ENV];
  process.env[DEV_CHILD_ENV] = "1";
});
afterEach(() => {
  if (previous === undefined) delete process.env[DEV_CHILD_ENV];
  else process.env[DEV_CHILD_ENV] = previous;
  vi.useRealTimers();
});

describe("canal de dev — membre rpc (ADR-0013 §6)", () => {
  it("le garde admet une trame objet, et rien d'autre", () => {
    const rpc = (frame: unknown) => ({
      channel: DEV_CHANNEL,
      type: "rpc",
      frame,
    });
    assert.ok(isDevChannelMessage(rpc({ jsonrpc: "2.0", method: "x" })));
    // Un lot est un objet : c'est le pair qui le juge (`invalid`), pas le garde.
    assert.ok(isDevChannelMessage(rpc([])));
    assert.ok(!isDevChannelMessage(rpc(null)));
    assert.ok(!isDevChannelMessage(rpc("{}")));
    assert.ok(!isDevChannelMessage({ channel: DEV_CHANNEL, type: "rpc" }));
  });

  it("les paramètres de command.execute sont vérifiés, bornés à 64 Kio", () => {
    assert.ok(isCommandExecuteParams(PARAMS));
    assert.ok(!isCommandExecuteParams({ ...PARAMS, command: "" }));
    assert.ok(!isCommandExecuteParams({ ...PARAMS, columns: 0 }));
    assert.ok(!isCommandExecuteParams({ ...PARAMS, columns: 80.5 }));
    assert.ok(!isCommandExecuteParams({ ...PARAMS, arguments: [1] }));
    assert.ok(!isCommandExecuteParams({ ...PARAMS, arguments: "x" }));
    assert.ok(!isCommandExecuteParams(["env"]));
    const fill = (n: number) => ["a".repeat(n - PARAMS.command.length)];
    assert.ok(
      isCommandExecuteParams({
        ...PARAMS,
        arguments: fill(MAX_LIVE_REQUEST_BYTES),
      }),
    );
    assert.ok(
      !isCommandExecuteParams({
        ...PARAMS,
        arguments: fill(MAX_LIVE_REQUEST_BYTES + 1),
      }),
    );
    // Des octets, pas des caractères : « é » en vaut deux.
    assert.ok(
      !isCommandExecuteParams({
        ...PARAMS,
        arguments: ["é".repeat(MAX_LIVE_REQUEST_BYTES / 2)],
      }),
    );
  });

  it("les sorties ne relaient pas le false de send() — seulement un canal fermé ou un envoi qui lève", () => {
    const endpoint = new ServerEndpoint();
    assert.strictEqual(sendRpcToSupervisor({ id: 1 }, endpoint), true);
    assert.strictEqual(sendRpcToSupervisor("x", endpoint), false);
    endpoint.connected = false;
    assert.strictEqual(sendRpcToSupervisor({ id: 1 }, endpoint), false);

    const child = new ServerChild(new ServerEndpoint());
    assert.strictEqual(sendRpcToServer(child, { id: 1 }), true);
    assert.strictEqual(sendRpcToServer(null, { id: 1 }), false);
    child.send = () => {
      throw new Error("channel closed");
    };
    assert.strictEqual(sendRpcToServer(child, { id: 1 }), false);
    child.connected = false;
    assert.strictEqual(sendRpcToServer(child, { id: 1 }), false);
  });
});

describe("voie en direct — serveur ⇄ superviseur", () => {
  it("dev.ready annonce le service ; la commande revient du serveur", async () => {
    const seen: unknown[] = [];
    const { peer } = wire((params) => {
      seen.push(params);
      return TEXT;
    });
    assert.strictEqual(peer.ready, false, "rien n'est encore arrivé");
    await until(() => peer.ready);
    assert.deepStrictEqual(await peer.execute(PARAMS), TEXT);
    assert.deepStrictEqual(seen, [PARAMS]);
  });

  it("live: false est une DONNÉE, pas une erreur", async () => {
    const { peer } = wire(() => NOT_LIVE);
    assert.deepStrictEqual(await peer.execute(PARAMS), { live: false });
  });

  it("des paramètres invalides sont refusés en -32602, sans atteindre l'exécuteur", async () => {
    let calls = 0;
    const { peer } = wire(() => {
      calls++;
      return TEXT;
    });
    await assert.rejects(peer.execute({ ...PARAMS, columns: -1 }), {
      code: JsonRpcError.INVALID_PARAMS,
    });
    assert.strictEqual(calls, 0);
  });

  it("une réponse de plus d'1 Mio est refusée en la nommant, jamais amputée", async () => {
    const big: CommandExecuteResult = {
      live: true,
      code: 0,
      parts: [{ text: "x".repeat(MAX_LIVE_RESULT_BYTES) }],
    };
    const { peer } = wire(() => big);
    await assert.rejects(peer.execute(PARAMS), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.strictEqual(Reflect.get(err, "code"), LIVE_RESULT_TOO_LARGE);
      const data: unknown = Reflect.get(err, "data");
      assert.ok(typeof data === "object" && data !== null);
      assert.strictEqual(Reflect.get(data, "max"), MAX_LIVE_RESULT_BYTES);
      assert.ok(Number(Reflect.get(data, "bytes")) > MAX_LIVE_RESULT_BYTES);
      return true;
    });
  });

  it("un producteur qui lève répond -32603 et laisse une trace dans le journal", async () => {
    const { peer, errors } = wire(() => {
      throw new Error("boom");
    });
    await assert.rejects(peer.execute(PARAMS), {
      code: JsonRpcError.INTERNAL_ERROR,
    });
    assert.ok(
      errors.some((c) => c.includes("command.execute")),
      errors.join(),
    );
  });

  it("Ctrl+C : l'invite rend la main, le producteur voit son signal abandonné", async () => {
    const calls: IRpcCall[] = [];
    const { peer } = wire(
      (_params, c) =>
        new Promise<CommandExecuteResult>(() => {
          calls.push(c);
        }),
    );
    const controller = new AbortController();
    const pending = peer.execute(PARAMS, controller.signal);
    await until(() => calls.length > 0);
    controller.abort(new Error("Ctrl+C"));
    await assert.rejects(pending, /Ctrl\+C/);
    await until(() => calls[0]?.signal.aborted === true);
  });

  it("délai de 5 s : la requête est rejetée ET annulée chez le serveur", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls: IRpcCall[] = [];
    const { peer } = wire(
      (_params, c) =>
        new Promise<CommandExecuteResult>(() => {
          calls.push(c);
        }),
    );
    const pending = peer.execute(PARAMS);
    await until(() => calls.length > 0);
    vi.advanceTimersByTime(LIVE_COMMAND_TIMEOUT_MS - 1);
    assert.strictEqual(calls[0]?.signal.aborted, false, "pas avant 5 s");
    vi.advanceTimersByTime(1);
    await assert.rejects(pending, /RPC timeout: command\.execute/);
    await until(() => calls[0]?.signal.aborted === true);
  });

  it("le serveur meurt pendant la requête : rejet dans l'instant, plus prêt", async () => {
    const { peer, child } = wire(
      () => new Promise<CommandExecuteResult>(() => {}),
    );
    await until(() => peer.ready);
    const pending = peer.execute(PARAMS);
    child.emit("disconnect");
    await assert.rejects(pending, /server exited/);
    assert.strictEqual(peer.ready, false);
    await assert.rejects(peer.execute(PARAMS), /server exited/);
  });

  it("la fermeture côté serveur retire l'écoute et abandonne les appels en cours", async () => {
    const calls: IRpcCall[] = [];
    const { endpoint, close, peer } = wire(
      (_params, c) =>
        new Promise<CommandExecuteResult>(() => {
          calls.push(c);
        }),
    );
    void peer.execute(PARAMS).catch(() => {});
    await until(() => calls.length > 0);
    assert.strictEqual(endpoint.listenerCount("message"), 1);
    close();
    assert.strictEqual(endpoint.listenerCount("message"), 0);
    assert.strictEqual(calls[0]?.signal.aborted, true);
  });

  it("ouverte une seule fois : un second appel ne pose ni pair ni dev.ready", async () => {
    const { endpoint, link } = wire(() => TEXT);
    const sent = endpoint.sent;
    const again = link.serveCommands(
      () => TEXT,
      () => {},
    );
    assert.strictEqual(endpoint.sent, sent);
    assert.strictEqual(endpoint.listenerCount("message"), 1);
    again();
    assert.strictEqual(
      endpoint.listenerCount("message"),
      1,
      "la seconde fermeture ne ferme rien",
    );
  });

  it("sans superviseur, rien n'est posé ni envoyé", () => {
    delete process.env[DEV_CHILD_ENV];
    const endpoint = new ServerEndpoint();
    const link = new SupervisorLink(host, {}, endpoint);
    const close = link.serveCommands(
      () => TEXT,
      () => {},
    );
    assert.strictEqual(endpoint.sent, 0);
    assert.strictEqual(endpoint.listenerCount("message"), 0);
    close();
  });

  it("l'aiguillage remet une trame rpc même sans terminal, jamais d'un serveur remplacé", () => {
    const frames: object[] = [];
    const routes = {
      applyHeldPlan: () => {
        throw new Error("aucun plan attendu");
      },
      retainHeldOwners: () => {},
      reply: () => {},
      receiveRpc: (frame: object) => void frames.push(frame),
      terminal: null,
    };
    const message: DevChannelMessage = {
      channel: DEV_CHANNEL,
      type: "rpc",
      frame: { jsonrpc: "2.0", method: "dev.ready" },
    };
    routeServerMessages({ ...routes, isCurrent: () => true })(message);
    routeServerMessages({ ...routes, isCurrent: () => false })(message);
    assert.strictEqual(frames.length, 1);
  });
});
