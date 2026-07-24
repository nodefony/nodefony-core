import { expect } from "chai";
import { JsonRpcPeer, RpcError, RpcEnvelope } from "../realtime/JsonRpcPeer";
import type {
  ActionsMap,
  DefaultEventsMap,
} from "../realtime/RealtimeEventMap";

/** Sucre local : une enveloppe (valeur + méta serveur) rendue par un handler. */
const RpcEnvelopeOf = (result: unknown, meta: Record<string, unknown>) =>
  new RpcEnvelope(result, meta);

/**
 * Contrat RPC du peer de test.
 *
 * Deux familles, deux intentions :
 *
 * 1. Les actions à `in` DÉCLARÉ (`do`, `gen`, `api.request`) : params et résultats
 *    sont VÉRIFIÉS par le compilateur à chaque appel du test.
 * 2. Les actions sans `in` : de simples NOMS par lesquels les tests exercent le
 *    moteur (register/unregister, timeout, dispose, propagation d'erreur). Elles
 *    ne portent aucun contrat de params — mais elles doivent figurer ici, car
 *    `ActionNames` ne fuit plus l'index signature de `ActionsMap` : un nom non
 *    déclaré est désormais refusé à la compile. C'est précisément le garde-fou
 *    recherché — le contrat dit ce qui existe, y compris en test.
 */
interface TestActions extends ActionsMap {
  do: { in: { a: number }; out: { ok: boolean } };
  gen: { in: Record<string, never>; out: unknown };
  "api.request": { in: { path: string }; out: unknown };
  "nodefony:kernel:ping": { out: unknown };
  ping: { out: unknown };
  x: { out: unknown };
  slow: { out: unknown };
  boom: { out: unknown };
  a: { out: unknown };
  b: { out: unknown };
}

/**
 * JsonRpcPeer = moteur protocole isomorphe. Tests purs : `send` est capturé dans un
 * tableau, `receive()` reçoit des frames JSON-RPC. Verrouille la discrimination
 * (request/notification/response) + le cycle request→response + actions + erreurs.
 */
function newPeer() {
  const sent: unknown[] = [];
  const notes: { method: string; params: unknown }[] = [];
  const errs: { ctx: string; err: unknown }[] = [];
  const peer = new JsonRpcPeer<DefaultEventsMap, DefaultEventsMap, TestActions>(
    {
      send: (f) => {
        sent.push(f);
      },
      onNotification: (method, params) => notes.push({ method, params }),
      onError: (ctx, err) => errs.push({ ctx, err }),
    },
  );
  return { peer, sent, notes, errs };
}

// Le dispatch d'une action est normalisé en Promise (sync OU async) → la réponse
// part dans une microtask. On flushe avant d'asserter `sent` pour une requête.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("JsonRpcPeer — moteur protocole isomorphe", () => {
  describe("receive() — discrimination", () => {
    it("REQUÊTE entrante (method+id) sur action enregistrée → renvoie result", async () => {
      const { peer, sent } = newPeer();
      peer.register("nodefony:kernel:ping", () => ({ pong: true }));
      const kind = peer.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "nodefony:kernel:ping",
      });
      expect(kind).to.equal("request");
      await flush();
      expect(sent).to.deep.equal([
        { jsonrpc: "2.0", id: 1, result: { pong: true } },
      ]);
    });

    it("REQUÊTE entrante méthode inconnue → -32601", () => {
      const { peer, sent } = newPeer();
      const kind = peer.receive({ jsonrpc: "2.0", id: 9, method: "nope" });
      expect(kind).to.equal("request");
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 9,
          error: { code: -32601, message: "method not found: nope" },
        },
      ]);
    });

    it("REQUÊTE entrante dont le handler throw → -32603 générique + onError", async () => {
      const { peer, sent, errs } = newPeer();
      peer.register("boom", () => {
        throw new Error("secret interne");
      });
      peer.receive({ jsonrpc: "2.0", id: 3, method: "boom" });
      await Promise.resolve(); // laisse la microtask du handler se résoudre
      await Promise.resolve();
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32603, message: "internal error" },
        },
      ]);
      expect(errs).to.have.length(1); // le détail est loggé serveur, pas envoyé
      expect((errs[0].err as Error).message).to.equal("secret interne");
    });

    it("REQUÊTE entrante à id STRING → réponse avec le même id string", async () => {
      const { peer, sent } = newPeer();
      peer.register("x", () => 42);
      peer.receive({ jsonrpc: "2.0", id: "abc", method: "x" });
      await flush();
      expect(sent).to.deep.equal([{ jsonrpc: "2.0", id: "abc", result: 42 }]);
    });

    it("NOTIFICATION (method sans id) → onNotification, AUCUNE réponse", () => {
      const { peer, sent, notes } = newPeer();
      const kind = peer.receive({
        jsonrpc: "2.0",
        method: "nodefony:dashboard",
        params: { cpu: 7 },
      });
      expect(kind).to.equal("notification");
      expect(notes).to.deep.equal([
        { method: "nodefony:dashboard", params: { cpu: 7 } },
      ]);
      expect(sent).to.have.length(0);
    });

    it("frame sans jsonrpc:2.0 → invalid, rien", () => {
      const { peer, sent, notes } = newPeer();
      expect(peer.receive({ method: "x" })).to.equal("invalid");
      expect(peer.receive(null)).to.equal("invalid");
      expect(peer.receive({ jsonrpc: "2.0" })).to.equal("invalid"); // ni method ni id
      expect(sent).to.have.length(0);
      expect(notes).to.have.length(0);
    });
  });

  describe("request() — cycle requête sortante → réponse", () => {
    it("envoie la frame puis résout sur la réponse result appariée par id", async () => {
      const { peer, sent } = newPeer();
      // `out: { ok: boolean }` vient du contrat `TestActions` — plus de param de
      // type explicite (`request<T>` n'existe plus : le 1ᵉʳ générique est la MÉTHODE).
      const p = peer.request("do", { a: 1 });
      expect(sent).to.deep.equal([
        { jsonrpc: "2.0", id: 1, method: "do", params: { a: 1 } },
      ]);
      peer.receive({ jsonrpc: "2.0", id: 1, result: { ok: true } });
      expect(await p).to.deep.equal({ ok: true });
    });

    it("rejette sur réponse error appariée", async () => {
      const { peer } = newPeer();
      const p = peer.request("do");
      peer.receive({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "boom" },
      });
      let msg = "";
      try {
        await p;
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).to.equal("boom");
    });

    it("réponse à un id INCONNU (déjà résolu/jamais émis) → ignorée", () => {
      const { peer } = newPeer();
      expect(() =>
        peer.receive({ jsonrpc: "2.0", id: 999, result: 1 }),
      ).to.not.throw();
    });

    it("timeout court → rejette", async () => {
      const { peer } = newPeer();
      const p = peer.request("slow", undefined, 5);
      let msg = "";
      try {
        await p;
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).to.contain("RPC timeout");
    });
  });

  describe("notify() + methods + dispose()", () => {
    it("notify envoie une notification sans id", () => {
      const { peer, sent } = newPeer();
      peer.notify("evt", { x: 1 });
      expect(sent).to.deep.equal([
        { jsonrpc: "2.0", method: "evt", params: { x: 1 } },
      ]);
    });

    it("methods liste les actions enregistrées", () => {
      const { peer } = newPeer();
      expect(peer.methods).to.deep.equal([]);
      peer.register("a", () => 0);
      peer.register("b", () => 0);
      expect(peer.methods.sort()).to.deep.equal(["a", "b"]);
      peer.unregister("a");
      expect(peer.methods).to.deep.equal(["b"]);
    });

    it("dispose rejette les requêtes en attente", async () => {
      const { peer } = newPeer();
      const p = peer.request("x");
      peer.dispose("socket closed");
      let msg = "";
      try {
        await p;
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).to.equal("socket closed");
    });
  });

  describe("RpcError — erreur applicative assumée (pont api.request)", () => {
    it("handler qui throw une RpcError → code/message/data renvoyés FIDÈLEMENT, ni onError ni audit", async () => {
      const { peer, sent, errs } = newPeer();
      peer.register("api.request", () => {
        throw new RpcError("not found /x", -32000, { status: 404 });
      });
      peer.receive({
        jsonrpc: "2.0",
        id: 5,
        method: "api.request",
        params: { path: "/x" },
      });
      await flush();
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 5,
          error: {
            code: -32000,
            message: "not found /x",
            data: { status: 404 },
          },
        },
      ]);
      // Erreur ASSUMÉE par le handler → pas un internal_error.
      expect(errs).to.have.length(0);
    });

    it("RpcError sans data → l'objet error ne porte PAS la clé data", async () => {
      const { peer, sent } = newPeer();
      peer.register("x", () => {
        throw new RpcError("params invalides", -32602);
      });
      peer.receive({ jsonrpc: "2.0", id: 6, method: "x" });
      await flush();
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 6,
          error: { code: -32602, message: "params invalides" },
        },
      ]);
    });

    it("requête SORTANTE : une réponse error rejette avec une RpcError (code + data lisibles)", async () => {
      const { peer } = newPeer();
      const p = peer.request("api.request", { path: "/y" });
      peer.receive({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "not found /y", data: { status: 404 } },
      });
      try {
        await p;
        expect.fail("aurait dû rejeter");
      } catch (e) {
        expect(e).to.be.instanceOf(RpcError);
        const err = e as RpcError;
        expect(err.code).to.equal(-32000);
        expect(err.message).to.equal("not found /y");
        expect(err.data).to.deep.equal({ status: 404 });
      }
    });

    it("un throw NON-RpcError reste opaque (-32603) — le contrat Zero Trust ne bouge pas", async () => {
      const { peer, sent, errs } = newPeer();
      peer.register("boom", () => {
        throw new Error("détail interne sensible");
      });
      peer.receive({ jsonrpc: "2.0", id: 7, method: "boom" });
      await flush();
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 7,
          error: { code: -32603, message: "internal error" },
        },
      ]);
      expect(errs).to.have.length(1);
    });
  });

  // ─── Seams sécurité (P13 Bloc A étape 2 → P6) ───────────────────────────────
  describe("seam sécu beforeDispatch (1/5)", () => {
    it("refuse une REQUÊTE → -32001 'unauthorized' + audit 'denied', handler NON appelé", () => {
      const sent: unknown[] = [];
      const audits: { reason: string; frame: unknown }[] = [];
      let handlerCalled = 0;
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
        beforeDispatch: () => false,
        onFrameAudit: (reason, frame) => audits.push({ reason, frame }),
      });
      peer.register("nodefony:kernel:ping", () => {
        handlerCalled++;
        return { pong: true };
      });
      const kind = peer.receive({
        jsonrpc: "2.0",
        id: 42,
        method: "nodefony:kernel:ping",
      });
      expect(kind).to.equal("request");
      expect(handlerCalled).to.equal(0);
      expect(sent).to.deep.equal([
        {
          jsonrpc: "2.0",
          id: 42,
          error: { code: -32001, message: "unauthorized" },
        },
      ]);
      expect(audits).to.have.length(1);
      expect(audits[0]!.reason).to.equal("denied");
    });

    it("refuse une NOTIFICATION → drop silencieux + audit 'denied', onNotification NON appelé", () => {
      const sent: unknown[] = [];
      const notes: { method: string; params: unknown }[] = [];
      const audits: string[] = [];
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
        onNotification: (method, params) => notes.push({ method, params }),
        beforeDispatch: () => false,
        onFrameAudit: (reason) => audits.push(reason),
      });
      const kind = peer.receive({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: "ch" },
      });
      expect(kind).to.equal("notification");
      expect(sent).to.deep.equal([]); // pas de réponse pour une notification
      expect(notes).to.deep.equal([]); // handler de notif NON appelé
      expect(audits).to.deep.equal(["denied"]);
    });

    it("autorise (true) → dispatch normal, AUCUN audit", async () => {
      const sent: unknown[] = [];
      const audits: string[] = [];
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
        beforeDispatch: () => true,
        onFrameAudit: (reason) => audits.push(reason),
      });
      peer.register("ping", () => ({ pong: true }));
      peer.receive({ jsonrpc: "2.0", id: 1, method: "ping" });
      await flush();
      expect(sent).to.deep.equal([
        { jsonrpc: "2.0", id: 1, result: { pong: true } },
      ]);
      expect(audits).to.deep.equal([]); // path heureux n'audit pas
    });

    it("le hook reçoit la frame complète + une réf du peer (pour voters P6)", () => {
      let seenFrame: unknown = null;
      let seenPeer: unknown = null;
      const peer = new JsonRpcPeer({
        send: () => {},
        beforeDispatch: (frame, p) => {
          seenFrame = frame;
          seenPeer = p;
          return true;
        },
      });
      const frame = { jsonrpc: "2.0", method: "ping", params: { x: 1 } };
      peer.receive(frame);
      expect(seenFrame).to.equal(frame);
      expect(seenPeer).to.equal(peer);
    });
  });

  describe("seam audit onFrameAudit (5/5)", () => {
    it("fire 'invalid' sur frame non conforme JSON-RPC 2.0", () => {
      const audits: { reason: string; frame: unknown }[] = [];
      const peer = new JsonRpcPeer({
        send: () => {},
        onFrameAudit: (reason, frame) => audits.push({ reason, frame }),
      });
      peer.receive({ jsonrpc: "1.0", method: "ping" }); // mauvaise version
      peer.receive(null);
      peer.receive("not-an-object");
      expect(audits.map((a) => a.reason)).to.deep.equal([
        "invalid",
        "invalid",
        "invalid",
      ]);
    });

    it("fire 'method_not_found' avant d'envoyer -32601", () => {
      const sent: unknown[] = [];
      const audits: string[] = [];
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
        onFrameAudit: (reason) => audits.push(reason),
      });
      peer.receive({ jsonrpc: "2.0", id: 7, method: "ghost" });
      expect(audits).to.deep.equal(["method_not_found"]);
      expect((sent[0] as { error: { code: number } }).error.code).to.equal(
        -32601,
      );
    });

    it("passe le `peer` en 3ᵉ argument (slot #6 forward-audit P6.14 — actor lookup)", () => {
      const audits: { reason: string; peer: unknown }[] = [];
      const peer = new JsonRpcPeer({
        send: () => {},
        onFrameAudit: (reason, _frame, p) => audits.push({ reason, peer: p }),
      });
      peer.receive({ jsonrpc: "2.0", id: 7, method: "ghost" });
      expect(audits).to.have.length(1);
      expect(audits[0]!.reason).to.equal("method_not_found");
      expect(audits[0]!.peer).to.equal(peer);
    });

    it("fire 'internal_error' quand un handler throw", async () => {
      const sent: unknown[] = [];
      const audits: string[] = [];
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
        onError: () => {},
        onFrameAudit: (reason) => audits.push(reason),
      });
      peer.register("boom", () => {
        throw new Error("kaboom");
      });
      peer.receive({ jsonrpc: "2.0", id: 8, method: "boom" });
      await flush();
      expect(audits).to.deep.equal(["internal_error"]);
      expect((sent[0] as { error: { code: number } }).error.code).to.equal(
        -32603,
      );
    });
  });

  describe("RpcEnvelope — méta serveur À CÔTÉ du result", () => {
    it("handler qui rend une enveloppe → frame {result, meta}, result NU (contrat REST préservé)", async () => {
      const { peer, sent } = newPeer();
      peer.register("api.request", () =>
        RpcEnvelopeOf({ modules: 3 }, { requestId: "abc.1" }),
      );
      peer.receive({ jsonrpc: "2.0", id: 7, method: "api.request" });
      await flush();
      const frame = sent[0] as {
        result: unknown;
        meta?: { requestId?: string };
      };
      // Le `result` reste la valeur nue — la méta n'y est PAS mélangée.
      expect(frame.result).to.deep.equal({ modules: 3 });
      expect(frame.meta?.requestId).to.equal("abc.1");
    });

    it("handler qui rend une valeur nue → aucun champ meta (0 octet de plus en prod)", async () => {
      const { peer, sent } = newPeer();
      peer.register("api.request", () => ({ modules: 3 }));
      peer.receive({ jsonrpc: "2.0", id: 8, method: "api.request" });
      await flush();
      expect(sent[0]).to.not.have.property("meta");
    });

    it("requestTraced() → { result, meta } ; request() → result nu (contrat inchangé)", async () => {
      const { peer, sent } = newPeer();
      const traced = peer.requestTraced("api.request", { path: "/x" });
      const plain = peer.request("api.request", { path: "/y" });
      const ids = sent.map((f) => (f as { id: number }).id);
      peer.receive({
        jsonrpc: "2.0",
        id: ids[0],
        result: { a: 1 },
        meta: { requestId: "conn.1" },
      });
      peer.receive({
        jsonrpc: "2.0",
        id: ids[1],
        result: { b: 2 },
        meta: { requestId: "conn.2" },
      });
      expect(await traced).to.deep.equal({
        result: { a: 1 },
        meta: { requestId: "conn.1" },
      });
      // L'appel ordinaire ignore la méta : il rend la valeur, comme avant.
      expect(await plain).to.deep.equal({ b: 2 });
    });
  });

  describe("bypass 0-coût quand les hooks sont absents", () => {
    it("sans beforeDispatch ni onFrameAudit → comportement identique à avant les seams", async () => {
      const sent: unknown[] = [];
      const peer = new JsonRpcPeer({
        send: (f) => {
          sent.push(f);
        },
      });
      peer.register("ping", () => ({ pong: true }));
      // chemin heureux : request → result (dispatch via microtask → arrive après les sends sync)
      peer.receive({ jsonrpc: "2.0", id: 1, method: "ping" });
      // chemin erreur : method not found → -32601 SYNC immédiat → ce send arrive en 1ᵉʳ
      peer.receive({ jsonrpc: "2.0", id: 2, method: "ghost" });
      // chemin invalide : silencieux
      const k = peer.receive({ jsonrpc: "1.0" });
      await flush();
      expect(k).to.equal("invalid");
      expect(sent).to.have.length(2);
      // Le -32601 (sync) précède le result (microtask). Vérifie les deux par id.
      const byId = new Map(
        sent.map((f) => [(f as { id: number | string }).id, f]),
      );
      expect((byId.get(2) as { error: { code: number } }).error.code).to.equal(
        -32601,
      );
      expect((byId.get(1) as { result: unknown }).result).to.deep.equal({
        pong: true,
      });
    });
  });
});
