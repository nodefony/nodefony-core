import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcPeer, RpcError } from "../realtime/JsonRpcPeer";
import type { IFrameCodec } from "../realtime/IFrameCodec";
import { JSON_FRAME_CODEC } from "../realtime/jsonFrameCodec";

/**
 * Le codec vit dans le pair PARTAGÉ (ADR-0022 §4, ligne (i)) : le pair encode ses
 * émissions, relit l'entrée, bascule de codec, et tient le filet d'une charge non
 * encodable — le même pour le navigateur et pour le serveur.
 */

/** Codec repérable : préfixe ses trames, compte ses encodages. */
function taggedCodec(tag: string) {
  const counter = { encoded: 0 };
  const codec: IFrameCodec = {
    protocol: `test.${tag}.v1`,
    encode(frame) {
      counter.encoded++;
      return `${tag}:${JSON.stringify(frame)}`;
    },
    decode(data) {
      const text = String(data);
      if (!text.startsWith(`${tag}:`)) throw new Error(`pas du ${tag}`);
      return JSON.parse(text.slice(tag.length + 1));
    },
  };
  return { codec, counter };
}

/** Pair à sortie `write` : capture les données écrites ET la frame en objet. */
function wirePeer(
  opts: {
    codec?: IFrameCodec;
    admit?: () => boolean;
    withOnError?: boolean;
  } = {},
) {
  const written: { data: string | Uint8Array; frame: unknown }[] = [];
  const errs: { ctx: string; err: unknown }[] = [];
  const audits: string[] = [];
  const peer = new JsonRpcPeer({
    write: (data, frame) => {
      written.push({ data, frame });
    },
    admit: opts.admit,
    codec: opts.codec,
    onError:
      opts.withOnError === false
        ? undefined
        : (ctx, err) => errs.push({ ctx, err }),
    onFrameAudit: (reason) => audits.push(reason),
  });
  return { peer, written, errs, audits };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Une structure circulaire : aucun codec JSON ne sait l'encoder. */
function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  o.self = o;
  return o;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JsonRpcPeer — le codec vit dans le pair (ADR-0022 §4)", () => {
  it("sans codec déclaré, une sortie `write` émet en JSON texte (nodefony.jsonrpc.v1)", () => {
    const { peer, written } = wirePeer();
    expect(peer.codec).toBe(JSON_FRAME_CODEC);
    peer.notify("chat:room", { text: "hé" });
    expect(written).toHaveLength(1);
    expect(written[0]?.data).toBe(
      '{"jsonrpc":"2.0","method":"chat:room","params":{"text":"hé"}}',
    );
    // La frame en objet accompagne les données, pour le journal — jamais réencodée.
    expect(written[0]?.frame).toEqual({
      jsonrpc: "2.0",
      method: "chat:room",
      params: { text: "hé" },
    });
  });

  it("encode avec le codec COURANT, et la bascule vaut pour l'émission ET pour decode", () => {
    const a = taggedCodec("A");
    const b = taggedCodec("B");
    const { peer, written } = wirePeer({ codec: a.codec });
    peer.notify("x", 1);
    peer.codec = b.codec;
    peer.notify("x", 2);
    expect(written.map((w) => String(w.data).slice(0, 2))).toEqual([
      "A:",
      "B:",
    ]);
    expect(a.counter.encoded).toBe(1);
    expect(b.counter.encoded).toBe(1);
    expect(peer.decode('B:{"jsonrpc":"2.0","method":"y"}')).toEqual({
      jsonrpc: "2.0",
      method: "y",
    });
    expect(() => peer.decode('A:{"jsonrpc":"2.0","method":"y"}')).toThrow(
      "pas du B",
    );
  });

  it("une réponse à une requête entrante sort par le codec courant", async () => {
    const t = taggedCodec("T");
    const { peer, written } = wirePeer({ codec: t.codec });
    peer.register("ping", () => ({ pong: true }));
    peer.receive(peer.decode('T:{"jsonrpc":"2.0","id":7,"method":"ping"}'));
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]?.data).toBe(
      'T:{"jsonrpc":"2.0","id":7,"result":{"pong":true}}',
    );
  });

  it("`admit` refuse : rien n'est encodé ni écrit, notify rend false, request rejette aussitôt", async () => {
    vi.useFakeTimers();
    const t = taggedCodec("T");
    const { peer, written } = wirePeer({ codec: t.codec, admit: () => false });
    expect(peer.notify("x", 1)).toBe(false);
    await expect(peer.request("y")).rejects.toThrow("RPC non émis");
    expect(t.counter.encoded).toBe(0);
    expect(written).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("JsonRpcPeer — filet d'une charge non encodable, le même des deux côtés", () => {
  it("réponse non encodable → -32603 générique au pair, détail à onError, audit internal_error", async () => {
    const { peer, written, errs, audits } = wirePeer();
    peer.register("leak", () => circular());
    peer.receive({ jsonrpc: "2.0", id: 3, method: "leak" });
    await flush();
    expect(written).toHaveLength(1);
    // Zero Trust : rien de la structure ne franchit le fil.
    expect(written[0]?.frame).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32603,
        message: "internal error: non-serializable payload",
      },
    });
    expect(errs).toHaveLength(1);
    expect(errs[0]?.ctx).toBe("rpc leak : réponse non encodable");
    expect(audits).toEqual(["internal_error"]);
  });

  it("RpcError dont `data` ne s'encode pas → -32603, jamais une chaîne cassée", async () => {
    const { peer, written } = wirePeer();
    peer.register("deny", () => {
      throw new RpcError("refus", -32000, circular());
    });
    peer.receive({ jsonrpc: "2.0", id: 4, method: "deny" });
    await flush();
    expect(written.map((w) => w.frame)).toEqual([
      {
        jsonrpc: "2.0",
        id: 4,
        error: {
          code: -32603,
          message: "internal error: non-serializable payload",
        },
      },
    ]);
  });

  it("requête aux paramètres non encodables → rejette CHEZ l'appelant, rien n'est émis, minuteur coupé", async () => {
    vi.useFakeTimers();
    const { peer, written } = wirePeer();
    await expect(peer.request("do", circular())).rejects.toThrow(TypeError);
    // Jamais une réponse forgée vers le pair avec l'id de NOTRE requête : il la
    // prendrait pour la réponse d'un de SES appels.
    expect(written).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notification non encodable : rapportée à onError et `false` ; sans onError, elle lève chez l'appelant", () => {
    const reported = wirePeer();
    expect(reported.peer.notify("x", circular())).toBe(false);
    expect(reported.errs.map((e) => e.ctx)).toEqual(["notify x"]);
    expect(reported.written).toHaveLength(0);

    const loud = wirePeer({ withOnError: false });
    expect(() => loud.peer.notify("x", circular())).toThrow(TypeError);
  });

  it("sortie `send` historique : le pair passe la frame en OBJET, sans l'encoder", () => {
    const sent: unknown[] = [];
    const peer = new JsonRpcPeer({ send: (f) => void sent.push(f) });
    peer.notify("x", 1);
    expect(sent).toEqual([{ jsonrpc: "2.0", method: "x", params: 1 }]);
  });
});
