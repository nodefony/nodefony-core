import { expect } from "chai";
import "mocha";
import "reflect-metadata";
import { RealtimeController } from "../../src/RealtimeController.js";
import { getRealtimeHub } from "../../src/RealtimeHub.js";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController.js";
import type { RpcActionHandler } from "nodefony";
import type { ContextType } from "@nodefony/http";

const OPEN = 1;

/**
 * Faux Context minimal — ne fournit QUE ce que RealtimeController touche :
 * `connection` (ws brute) + `once("onFinish")`. Le reste (container/nc) est créé
 * par Service quand absent (cf construction `{} as ContextType` des tests décorateurs).
 */
function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  let onFinish: (() => void) | null = null;
  const conn = {
    readyState: OPEN,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(JSON.parse(data));
      cb?.();
    },
    close: () => {},
  };
  const ctx = {
    connection: conn,
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") onFinish = fn;
    },
  };
  return { ctx, sent, fireFinish: () => onFinish?.() };
}

/** Sous-classe de test : déclare canaux + actions, expose un pont public `feed`. */
class TestRt extends RealtimeController {
  channelCalls: string[] = [];
  disposed: string[] = [];
  publishers: Record<string, RealtimePublish> = {};

  constructor(ctx: unknown) {
    super("test-rt", ctx as ContextType);
  }

  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    this.channelCalls.push(channel);
    this.publishers[channel] = publish;
    if (channel === "bad") return null; // canal inconnu
    return () => {
      this.disposed.push(channel);
    };
  }

  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      "kernel:ping": () => ({ pong: true }),
      boom: () => {
        throw new Error("secret interne");
      },
    };
  }

  protected override realtimeChannels(): string[] {
    return ["tick", "logs"];
  }

  inboundCalls: unknown[] = [];
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {
      "sip:line1": (params, reply) => {
        this.inboundCalls.push(params);
        reply({ ack: true });
      },
    };
  }

  /** Pont public pour les tests (handleRealtime est protected). */
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const frame = (o: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: "2.0", ...o });

describe("RealtimeController — base endpoint WS (protocole factorisé)", () => {
  // Le hub des canaux est un singleton PAR PROCESS partagé entre connexions → on le
  // remet à zéro entre tests (sinon un canal d'un test précédent fausse le suivant).
  beforeEach(() => getRealtimeHub().clear());

  describe("handshake", () => {
    it("message null → welcome (canaux + actions découvrables)", () => {
      const { ctx, sent } = makeCtx();
      new TestRt(ctx).feed(null);
      expect(sent).to.have.length(1);
      expect(sent[0].method).to.equal("realtime:welcome");
      const params = sent[0].params as Record<string, unknown>;
      expect(params.protocol).to.equal("jsonrpc-2.0");
      expect(params.channels).to.deep.equal(["tick", "logs"]);
      expect(params.methods).to.deep.equal(["kernel:ping", "boom"]);
    });

    it("handshake idempotent (2e null = pas de double welcome)", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(null);
      expect(
        sent.filter((f) => f.method === "realtime:welcome"),
      ).to.have.length(1);
    });
  });

  describe("pub/sub par canal", () => {
    it("subscribe → createRealtimeChannel appelé (provider démarré)", () => {
      const { ctx } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      expect(rt.channelCalls).to.deep.equal(["tick"]);
    });

    it("subscribe en double → provider démarré UNE seule fois", () => {
      const { ctx } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      expect(rt.channelCalls).to.deep.equal(["tick"]);
    });

    it("le provider pousse via publish → notification serveur→client", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      rt.publishers["tick"]("tick", { v: 1 });
      const note = sent.find((f) => f.method === "tick");
      expect(note).to.exist;
      expect(note!.params).to.deep.equal({ v: 1 });
    });

    it("unsubscribe → dispose du provider", () => {
      const { ctx } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      rt.feed(frame({ method: "unsubscribe", params: { channel: "tick" } }));
      expect(rt.disposed).to.deep.equal(["tick"]);
    });

    it("canal inconnu (createRealtimeChannel→null) → rien, pas de crash", () => {
      const { ctx } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "bad" } }));
      // unsubscribe d'un canal jamais démarré = no-op
      expect(() =>
        rt.feed(frame({ method: "unsubscribe", params: { channel: "bad" } })),
      ).to.not.throw();
      expect(rt.disposed).to.have.length(0);
    });

    it("onFinish (close WS) → tous les providers actifs sont disposés", () => {
      const { ctx, fireFinish } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "subscribe", params: { channel: "tick" } }));
      rt.feed(frame({ method: "subscribe", params: { channel: "logs" } }));
      fireFinish();
      expect(rt.disposed.sort()).to.deep.equal(["logs", "tick"]);
    });
  });

  describe("full-duplex (entrée client → handler gated)", () => {
    it("notification sur un canal entrant déclaré → handler appelé + reply sur le même canal", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ method: "sip:line1", params: { invite: 1 } }));
      expect(rt.inboundCalls).to.deep.equal([{ invite: 1 }]);
      const reply = sent.find((f) => f.method === "sip:line1");
      expect(reply).to.exist;
      expect(reply!.params).to.deep.equal({ ack: true });
    });

    it("notification sur un canal NON déclaré entrant → ignorée (sûr par défaut)", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      const before = sent.length;
      rt.feed(frame({ method: "sip:lineX", params: { x: 1 } }));
      expect(rt.inboundCalls).to.have.length(0);
      expect(sent.length).to.equal(before); // aucune sortie
    });
  });

  describe("actions (requête → réponse)", () => {
    it("kernel:ping (action enregistrée) → result apparié par id", async () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ id: 5, method: "kernel:ping" }));
      await flush();
      const resp = sent.find((f) => f.id === 5);
      expect(resp).to.exist;
      expect(resp!.result).to.deep.equal({ pong: true });
    });

    it("action qui throw → -32603 générique (détail non fui au client)", async () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ id: 6, method: "boom" }));
      await flush();
      const resp = sent.find((f) => f.id === 6);
      expect(resp!.error).to.deep.equal({
        code: -32603,
        message: "internal error",
      });
    });

    it("méthode inconnue → -32601", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      rt.feed(frame({ id: 7, method: "nope" }));
      const resp = sent.find((f) => f.id === 7);
      expect((resp!.error as { code: number }).code).to.equal(-32601);
    });

    it("RÉPONSE entrante (id sans method) → IGNORÉE (pas de -32601 à tort)", () => {
      const { ctx, sent } = makeCtx();
      const rt = new TestRt(ctx);
      rt.feed(null);
      const before = sent.length;
      rt.feed(frame({ id: 8, result: { fake: true } }));
      expect(sent.length).to.equal(before); // aucune réponse émise
    });
  });
});
