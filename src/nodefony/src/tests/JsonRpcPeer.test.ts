import { expect } from "chai";
import "mocha";
import { JsonRpcPeer } from "../realtime/JsonRpcPeer";

/**
 * JsonRpcPeer = moteur protocole isomorphe. Tests purs : `send` est capturé dans un
 * tableau, `receive()` reçoit des frames JSON-RPC. Verrouille la discrimination
 * (request/notification/response) + le cycle request→response + actions + erreurs.
 */
function newPeer() {
  const sent: unknown[] = [];
  const notes: { method: string; params: unknown }[] = [];
  const errs: { ctx: string; err: unknown }[] = [];
  const peer = new JsonRpcPeer({
    send: (f) => sent.push(f),
    onNotification: (method, params) => notes.push({ method, params }),
    onError: (ctx, err) => errs.push({ ctx, err }),
  });
  return { peer, sent, notes, errs };
}

// Le dispatch d'une action est normalisé en Promise (sync OU async) → la réponse
// part dans une microtask. On flushe avant d'asserter `sent` pour une requête.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("JsonRpcPeer — moteur protocole isomorphe", () => {
  describe("receive() — discrimination", () => {
    it("REQUÊTE entrante (method+id) sur action enregistrée → renvoie result", async () => {
      const { peer, sent } = newPeer();
      peer.register("kernel:ping", () => ({ pong: true }));
      const kind = peer.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "kernel:ping",
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
        method: "dashboard:stats",
        params: { cpu: 7 },
      });
      expect(kind).to.equal("notification");
      expect(notes).to.deep.equal([
        { method: "dashboard:stats", params: { cpu: 7 } },
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
      const p = peer.request<{ ok: boolean }>("do", { a: 1 });
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

  describe("requestStream() — chunks", () => {
    it("accumule les chunks puis résout au done", async () => {
      const { peer } = newPeer();
      const chunks: unknown[] = [];
      const p = peer.requestStream("gen", {}, (c) => chunks.push(c));
      peer.receive({
        jsonrpc: "2.0",
        id: 1,
        stream: { chunk: "a", done: false },
      });
      peer.receive({
        jsonrpc: "2.0",
        id: 1,
        stream: { chunk: "b", done: true },
      });
      const all = await p;
      expect(chunks).to.deep.equal(["a", "b"]);
      expect(all).to.deep.equal(["a", "b"]);
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
});
