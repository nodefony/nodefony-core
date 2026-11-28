import { getEventListeners } from "node:events";
import { expect, vi } from "vitest";
import {
  JSON_RPC_CANCEL_REQUEST,
  JSON_RPC_PROGRESS,
  JsonRpcBaseProtocolError,
  JsonRpcError,
} from "../jsonrpc/index";
import {
  JsonRpcPeer,
  type IRpcCall,
  type IRpcProgress,
} from "../realtime/JsonRpcPeer";
import type { DefaultEventsMap } from "../realtime/RealtimeEventMap";

/**
 * Annulation (`$/cancelRequest`) et flux (`$/progress`) du pair JSON-RPC —
 * protocole de base LSP, ADR-0013 §6 (#538). Deux faces : l'APPELANT (signal,
 * délai, onProgress) et le RÉPONDANT (`registerCall`, `IRpcCall`).
 */

type Actions = {
  work: { in: { n: number }; out: string };
  plain: { in: undefined; out: string };
};

interface IFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  meta?: Record<string, unknown>;
}

function newPeer() {
  const sent: IFrame[] = [];
  const notes: string[] = [];
  const errs: string[] = [];
  const audits: string[] = [];
  const peer = new JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, Actions>({
    send: (f) => {
      sent.push(f as IFrame);
    },
    onNotification: (method) => notes.push(method),
    onError: (ctx) => errs.push(ctx),
    onFrameAudit: (reason) => audits.push(reason),
  });
  return { peer, sent, notes, errs, audits };
}

/** Deux pairs reliés en mémoire, avec les frames qui passent dans chaque sens. */
function linkedPeers() {
  const toServer: IFrame[] = [];
  const toClient: IFrame[] = [];
  let server: JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, Actions> | null =
    null;
  const client = new JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, Actions>({
    send: (f) => {
      toServer.push(f as IFrame);
      queueMicrotask(() => server?.receive(f));
    },
  });
  server = new JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, Actions>({
    send: (f) => {
      toClient.push(f as IFrame);
      queueMicrotask(() => client.receive(f));
    },
  });
  return { client, server, toServer, toClient };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("la promesse a été tenue");
}

describe("JsonRpcPeer — annulation et flux (protocole de base LSP)", () => {
  describe("appelant : signal et délai", () => {
    it("abandon → rejet avec la raison du signal, PUIS `$/cancelRequest { id }`", async () => {
      const { peer, sent } = newPeer();
      const ac = new AbortController();
      const p = peer.request("work", { n: 1 }, { signal: ac.signal });
      expect(sent).to.have.length(1);
      const reason = new Error("Ctrl+C");
      ac.abort(reason);
      expect(await rejection(p)).to.equal(reason);
      expect(sent[1]).to.deep.equal({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: sent[0]?.id },
      });
    });

    it("la réponse `-32800` arrivée après l'abandon est ignorée, sans audit", async () => {
      const { peer, sent, audits } = newPeer();
      const ac = new AbortController();
      const p = peer.request("work", { n: 1 }, { signal: ac.signal });
      ac.abort();
      await rejection(p);
      const kind = peer.receive({
        jsonrpc: "2.0",
        id: sent[0]?.id,
        error: {
          code: JsonRpcBaseProtocolError.REQUEST_CANCELLED,
          message: "Request cancelled",
        },
      });
      expect(kind).to.equal("response");
      expect(audits).to.deep.equal([]);
    });

    it("signal DÉJÀ abandonné → rejet immédiat, rien n'est émis", async () => {
      const { peer, sent } = newPeer();
      const ac = new AbortController();
      ac.abort(new Error("trop tard"));
      const e = await rejection(
        peer.request("work", { n: 1 }, { signal: ac.signal }),
      );
      expect((e as Error).message).to.equal("trop tard");
      expect(sent).to.deep.equal([]);
    });

    it("délai expiré → rejet `RPC timeout`, PUIS `$/cancelRequest` (personne n'attend plus)", async () => {
      const { peer, sent } = newPeer();
      const e = await rejection(
        peer.request("work", { n: 1 }, { timeoutMs: 5 }),
      );
      expect((e as Error).message).to.contain("RPC timeout: work");
      expect(sent.map((f) => f.method)).to.deep.equal([
        "work",
        JSON_RPC_CANCEL_REQUEST,
      ]);
    });

    it("un délai NOMBRE annule aussi (forme historique)", async () => {
      const { peer, sent } = newPeer();
      await rejection(peer.request("work", { n: 1 }, 5));
      expect(sent[1]?.method).to.equal(JSON_RPC_CANCEL_REQUEST);
    });

    it("réponse reçue → minuteur coupé et écouteur du signal RETIRÉ", async () => {
      vi.useFakeTimers();
      try {
        const { peer, sent } = newPeer();
        const ac = new AbortController();
        const p = peer.request("work", { n: 1 }, { signal: ac.signal });
        expect(vi.getTimerCount()).to.equal(1);
        expect(getEventListeners(ac.signal, "abort")).to.have.length(1);
        peer.receive({ jsonrpc: "2.0", id: sent[0]?.id, result: "ok" });
        expect(await p).to.equal("ok");
        expect(vi.getTimerCount()).to.equal(0);
        expect(getEventListeners(ac.signal, "abort")).to.have.length(0);
        ac.abort();
        expect(sent).to.have.length(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("délai expiré ou réponse d'erreur → écouteur du signal retiré aussi", async () => {
      const { peer, sent } = newPeer();
      const ac = new AbortController();
      await rejection(
        peer.request("work", { n: 1 }, { signal: ac.signal, timeoutMs: 5 }),
      );
      const p = peer.request("work", { n: 2 }, { signal: ac.signal });
      peer.receive({
        jsonrpc: "2.0",
        id: sent.at(-1)?.id,
        error: { code: -32000, message: "non" },
      });
      await rejection(p);
      expect(getEventListeners(ac.signal, "abort")).to.have.length(0);
    });

    it("dispose → rejet, écouteur retiré, aucun `$/cancelRequest`", async () => {
      const { peer, sent } = newPeer();
      const ac = new AbortController();
      const p = peer.request("work", { n: 1 }, { signal: ac.signal });
      peer.dispose("superviseur parti");
      expect(((await rejection(p)) as Error).message).to.equal(
        "superviseur parti",
      );
      ac.abort();
      expect(sent).to.have.length(1);
    });

    it("un transport qui répond PENDANT l'émission ne laisse aucun minuteur armé", async () => {
      vi.useFakeTimers();
      try {
        const peer: JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, Actions> =
          new JsonRpcPeer({
            send: (f) => {
              const id = (f as IFrame).id;
              peer.receive({ jsonrpc: "2.0", id, result: "tout de suite" });
            },
          });
        const ac = new AbortController();
        const p = peer.request("work", { n: 1 }, { signal: ac.signal });
        expect(vi.getTimerCount()).to.equal(0);
        expect(await p).to.equal("tout de suite");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("appelant : flux", () => {
    it("sans `onProgress`, la requête ne porte AUCUNE clé `meta`", () => {
      const { peer, sent } = newPeer();
      void peer.request("work", { n: 1 }).catch(() => undefined);
      expect(sent[0]).to.not.have.property("meta");
      peer.dispose();
    });

    it("`onProgress` → `meta.progressToken` = l'id ; chaque `$/progress` arrive, plus rien après la réponse", async () => {
      const { peer, sent, notes } = newPeer();
      const steps: IRpcProgress[] = [];
      const p = peer.request(
        "work",
        { n: 1 },
        { onProgress: (v) => steps.push(v) },
      );
      const id = sent[0]?.id;
      expect(sent[0]?.meta).to.deep.equal({ progressToken: id });
      const step = (progress: number) =>
        peer.receive({
          jsonrpc: "2.0",
          method: JSON_RPC_PROGRESS,
          params: { token: id, value: { progress } },
        });
      step(1);
      step(2);
      peer.receive({ jsonrpc: "2.0", id, result: "fini" });
      step(3);
      expect(await p).to.equal("fini");
      expect(steps.map((s) => s.progress)).to.deep.equal([1, 2]);
      expect(notes).to.deep.equal([]);
    });

    it("un `onProgress` qui lève → `onError`, et `receive` ne lève pas", () => {
      const { peer, sent, errs } = newPeer();
      void peer
        .request(
          "work",
          { n: 1 },
          {
            onProgress: () => {
              throw new Error("écran cassé");
            },
          },
        )
        .catch(() => undefined);
      expect(() =>
        peer.receive({
          jsonrpc: "2.0",
          method: JSON_RPC_PROGRESS,
          params: { token: sent[0]?.id, value: { progress: 1 } },
        }),
      ).to.not.throw();
      expect(errs).to.have.length(1);
      peer.dispose();
    });
  });

  describe("répondant : registerCall", () => {
    it("`$/cancelRequest` → signal abandonné, réponse `-32800` IMMÉDIATE, valeur tardive jetée", async () => {
      const { peer, sent } = newPeer();
      let seen: IRpcCall | null = null;
      let finish: (v: string) => void = () => undefined;
      peer.registerCall("work", (_params, call) => {
        seen = call;
        return new Promise<string>((r) => {
          finish = r;
        });
      });
      peer.receive({ jsonrpc: "2.0", id: 9, method: "work", params: { n: 1 } });
      await flush();
      const call = seen as IRpcCall | null;
      expect(call?.id).to.equal(9);
      const signal = call?.signal;
      expect(signal?.aborted).to.equal(false);
      peer.receive({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: 9 },
      });
      expect(signal?.aborted).to.equal(true);
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 9,
          error: {
            code: JsonRpcBaseProtocolError.REQUEST_CANCELLED,
            message: "Request cancelled",
          },
        },
      ]);
      finish("trop tard");
      await flush();
      expect(sent).to.have.length(1);
    });

    it("annuler un id inconnu, ou après la réponse → ignoré (une seule réponse)", async () => {
      const { peer, sent } = newPeer();
      peer.registerCall("work", () => "fait");
      peer.receive({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: 404 },
      });
      peer.receive({ jsonrpc: "2.0", id: 1, method: "work", params: { n: 1 } });
      await flush();
      peer.receive({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: 1 },
      });
      expect(sent).to.deep.equal([{ jsonrpc: "2.0", id: 1, result: "fait" }]);
    });

    it("une action de `register` n'est pas annulable : sa réponse part normalement", async () => {
      const { peer, sent } = newPeer();
      peer.register("plain", () => "normal");
      peer.receive({ jsonrpc: "2.0", id: 2, method: "plain" });
      peer.receive({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: 2 },
      });
      await flush();
      expect(sent).to.deep.equal([{ jsonrpc: "2.0", id: 2, result: "normal" }]);
    });

    it("`progress()` sans jeton demandé → `false`, rien n'est émis", async () => {
      const { peer, sent } = newPeer();
      let ok: boolean | null = null;
      peer.registerCall("work", (_p, call) => {
        ok = call.progress({ message: "étape" });
        return "fait";
      });
      peer.receive({ jsonrpc: "2.0", id: 3, method: "work", params: { n: 1 } });
      await flush();
      expect(ok).to.equal(false);
      expect(sent).to.deep.equal([{ jsonrpc: "2.0", id: 3, result: "fait" }]);
    });

    it("`progress()` avec jeton → `$/progress { token, value }` numéroté, puis `false` après la réponse", async () => {
      const { peer, sent } = newPeer();
      let late: IRpcCall | null = null;
      peer.registerCall("work", (_p, call) => {
        late = call;
        call.progress({ parts: [{ text: "a\n" }] });
        call.progress({ message: "b", total: 2 });
        return "fait";
      });
      peer.receive({
        jsonrpc: "2.0",
        id: "s1",
        method: "work",
        params: { n: 1 },
        meta: { progressToken: "tok" },
      });
      await flush();
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          method: JSON_RPC_PROGRESS,
          params: {
            token: "tok",
            value: { parts: [{ text: "a\n" }], progress: 1 },
          },
        },
        {
          jsonrpc: "2.0",
          method: JSON_RPC_PROGRESS,
          params: {
            token: "tok",
            value: { message: "b", total: 2, progress: 2 },
          },
        },
        { jsonrpc: "2.0", id: "s1", result: "fait" },
      ]);
      expect(
        (late as IRpcCall | null)?.progress({ message: "après" }),
      ).to.equal(false);
    });

    it("un `meta` réseau malformé (null, nombre) ne lève pas : pas de flux", async () => {
      const { peer, sent } = newPeer();
      peer.registerCall("work", (_p, call) => String(call.progress({})));
      peer.receive({ jsonrpc: "2.0", id: 4, method: "work", meta: null });
      peer.receive({ jsonrpc: "2.0", id: 5, method: "work", meta: 7 });
      await flush();
      expect(sent.map((f) => f.result)).to.deep.equal(["false", "false"]);
    });

    it("dispose → le signal des appels entrants est abandonné, leur valeur jetée", async () => {
      const { peer, sent } = newPeer();
      let signal: AbortSignal | null = null;
      let finish: (v: string) => void = () => undefined;
      peer.registerCall("work", (_p, call) => {
        signal = call.signal;
        return new Promise<string>((r) => {
          finish = r;
        });
      });
      peer.receive({ jsonrpc: "2.0", id: 6, method: "work", params: { n: 1 } });
      await flush();
      peer.dispose("superviseur parti");
      expect((signal as AbortSignal | null)?.aborted).to.equal(true);
      finish("orpheline");
      await flush();
      expect(sent).to.deep.equal([]);
    });

    it("un signal lu pour la PREMIÈRE fois après l'abandon naît abandonné, avec sa raison", async () => {
      const { peer } = newPeer();
      const calls: IRpcCall[] = [];
      peer.registerCall("work", (_p, call) => {
        calls.push(call);
        return new Promise<string>(() => undefined);
      });
      peer.receive({ jsonrpc: "2.0", id: 7, method: "work", params: { n: 1 } });
      peer.receive({ jsonrpc: "2.0", id: 8, method: "work", params: { n: 2 } });
      await flush();
      // Le handler ne l'a pas encore lu : il l'interrogera au retour d'un `await`.
      peer.receive({
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id: 7 },
      });
      peer.dispose("superviseur parti");
      const [cancelled, disposed] = calls;
      expect(cancelled?.signal.aborted).to.equal(true);
      expect(disposed?.signal.aborted).to.equal(true);
      expect(String(disposed?.signal.reason)).to.contain("superviseur parti");
    });
  });

  describe("méthodes `$/` interceptées par le pair", () => {
    it("une notification `$/…` n'atteint JAMAIS `onNotification` (joker compris)", () => {
      const { peer, notes, sent } = newPeer();
      for (const method of [
        JSON_RPC_CANCEL_REQUEST,
        JSON_RPC_PROGRESS,
        "$/setTrace",
      ]) {
        expect(
          peer.receive({ jsonrpc: "2.0", method, params: { id: 1 } }),
        ).to.equal("notification");
      }
      expect(notes).to.deep.equal([]);
      expect(sent).to.deep.equal([]);
    });

    it("une REQUÊTE `$/…` → `-32601` (LSP)", () => {
      const { peer, sent, audits } = newPeer();
      peer.receive({ jsonrpc: "2.0", id: 7, method: "$/cancelRequest" });
      expect(sent[0]?.error?.code).to.equal(JsonRpcError.METHOD_NOT_FOUND);
      expect(audits).to.deep.equal(["method_not_found"]);
    });

    it("les méthodes `$/` passent avant `beforeDispatch` : la garde n'a rien à en juger", () => {
      const gate: string[] = [];
      const peer = new JsonRpcPeer({
        send: () => undefined,
        beforeDispatch: (frame) => {
          gate.push(frame.method);
          return false;
        },
      });
      peer.receive({
        jsonrpc: "2.0",
        method: JSON_RPC_CANCEL_REQUEST,
        params: { id: 1 },
      });
      peer.receive({ jsonrpc: "2.0", method: "chan", params: {} });
      expect(gate).to.deep.equal(["chan"]);
    });
  });

  describe("bout en bout : deux pairs reliés", () => {
    it("l'appelant abandonne un flux : il rejette, le répondant voit son signal tomber et répond `-32800`", async () => {
      const { client, server, toClient } = linkedPeers();
      const steps: number[] = [];
      let serverSignal: AbortSignal | null = null;
      server.registerCall("work", (_p, call) => {
        serverSignal = call.signal;
        call.progress({ message: "début" });
        return new Promise<string>(() => undefined);
      });
      const ac = new AbortController();
      const p = client.request(
        "work",
        { n: 1 },
        {
          signal: ac.signal,
          onProgress: (v) => steps.push(v.progress),
        },
      );
      await flush();
      expect(steps).to.deep.equal([1]);
      ac.abort(new Error("Ctrl+C"));
      expect(((await rejection(p)) as Error).message).to.equal("Ctrl+C");
      await flush();
      expect((serverSignal as AbortSignal | null)?.aborted).to.equal(true);
      expect(toClient.at(-1)?.error?.code).to.equal(
        JsonRpcBaseProtocolError.REQUEST_CANCELLED,
      );
    });
  });
});
