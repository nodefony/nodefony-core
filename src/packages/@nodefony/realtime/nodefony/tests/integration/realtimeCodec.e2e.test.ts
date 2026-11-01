import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
// Serveur : le codec et `RpcError` du dist `nodefony`, ceux que charge le service.
import { RpcError as RpcErrorServer, type RpcActionHandler } from "nodefony";
import { CBOR_FRAME_CODEC as SERVER_CBOR } from "nodefony/cbor";
import type { ContextType } from "@nodefony/http";
// Client : EN SOURCE, comme les autres bancs de jonction du paquet.
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import { RpcError } from "../../../../../../nodefony/src/realtime/JsonRpcPeer.js";
import { CBOR_FRAME_CODEC } from "../../../../../../nodefony/src/realtime/codec/frameCodec.js";
import {
  TransportState,
  type RealtimeFrameData,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";
import { LoopbackClientTransport, LoopbackWire } from "../helpers/loopback.js";

/**
 * #618 — le codec binaire de bout en bout, côté SERVEUR : négociation au
 * handshake, sous-protocole CHOISI confié à l'admission, champ `codec` de
 * l'accueil, bascule APRÈS l'accueil, frames CBOR dans les deux sens, trame
 * illisible écartée sans réponse (ADR-0022 §2 et §3).
 *
 * VRAI `NodefonySocket` ↔ VRAI `RealtimeController`, fil loopback : seul le
 * transport est simulé, le protocole et les codecs sont réels. L'aller-retour
 * sur un vrai serveur WebSocket est le banc d'intégration de `@nodefony/http`.
 */

const CBOR = "nodefony.jsonrpc.cbor.v1";
const TEXT = "nodefony.jsonrpc.v1";
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class CodecRt extends RealtimeController {
  /** Trames reçues par le crochet brut — doit rester vide sous codec binaire. */
  readonly rawFrames: Uint8Array[] = [];

  constructor(ctx: ContextType) {
    super("CodecRt", ctx);
  }

  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      // Renvoie la charge telle que reçue : octets compris.
      echo: (params) => ({ echoed: params }),
      fail: () => {
        throw new RpcErrorServer("refusé", -32000, { status: 409 });
      },
    };
  }

  protected override onRealtimeBinary(data: Uint8Array): void {
    this.rawFrames.push(data);
  }

  feed(raw: RealtimeFrameData | null): void {
    this.handleRealtime(raw);
  }

  pushRaw(data: Uint8Array): boolean {
    return this.sendBinaryToClient(data);
  }
}

interface IServerSide {
  rt: CodecRt;
  /** Choix confiés à l'admission, dans l'ordre (`undefined` = aucun appel). */
  selected: (string | false)[];
  /** Trames émises par le serveur, telles qu'écrites sur le fil. */
  sent: RealtimeFrameData[];
  /** Trames illisibles comptées par le transport de la connexion. */
  malformed: () => number | undefined;
}

function makeServer(
  wire: LoopbackWire,
  offer: string | undefined,
): IServerSide {
  const selected: (string | false)[] = [];
  const sent: RealtimeFrameData[] = [];
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? 1 : TransportState.CLOSED;
    },
    bufferedAmount: 0,
    send: (raw: RealtimeFrameData, cb?: (err?: Error) => void) => {
      sent.push(raw);
      wire.deliverToClient(raw);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      wire.serverConnOpen = false;
      queueMicrotask(() => wire.closeClient?.(code ?? 1000, reason ?? ""));
    },
  };
  const headers: Record<string, string> = {};
  if (offer !== undefined) headers["sec-websocket-protocol"] = offer;
  const ctx = {
    type: "websocket",
    connection: conn,
    once: () => undefined,
    request: { headers, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
    // Le contrôleur WS est construit AVANT le `101` : il confie son choix ici.
    admission: {
      selectSubprotocol: (p: string | false) => selected.push(p),
    },
  };
  const rt = new CodecRt(ctx as unknown as ContextType);
  wire.feedServer = (raw) => rt.feed(raw);
  const state = ctx as {
    __nfRealtime?: { transport: { malformedDiscarded: number } };
  };
  return {
    rt,
    selected,
    sent,
    malformed: () => state.__nfRealtime?.transport.malformedDiscarded,
  };
}

async function connect(
  clientCodec: boolean,
  offerHeader: string | undefined,
): Promise<{
  client: NodefonySocket;
  server: IServerSide;
  offered: readonly string[] | undefined;
  wire: LoopbackWire;
}> {
  const wire = new LoopbackWire();
  const server = makeServer(wire, offerHeader);
  const transport = new LoopbackClientTransport(wire);
  let offered: readonly string[] | undefined;
  const client = new NodefonySocket(
    {
      url: "ws://loopback/realtime",
      autoReconnect: false,
      ...(clientCodec ? { codec: CBOR_FRAME_CODEC } : {}),
    },
    (_url, protocols) => {
      offered = protocols;
      return transport;
    },
  );
  await client.connect();
  await flush();
  await flush();
  return { client, server, offered, wire };
}

describe("Codec binaire côté serveur — négociation, accueil, bascule (#618)", () => {
  beforeEach(() => {
    const hub = getRealtimeHub();
    hub.clear();
    hub.setFrameCodec(SERVER_CBOR);
  });

  it("client CBOR ↔ serveur CBOR : choix renvoyé, `codec` à l'accueil, frames binaires ensuite", async () => {
    const { client, server, offered } = await connect(true, `${CBOR}, ${TEXT}`);
    // Le client offre CBOR puis le texte ; le serveur confie CBOR à l'admission.
    expect(offered).toEqual([CBOR, TEXT]);
    expect(server.selected).toEqual([CBOR]);
    // L'accueil est une trame TEXTE qui porte le codec ; tout ce qui suit est binaire.
    const welcome = server.sent[0];
    expect(typeof welcome).toBe("string");
    expect(JSON.parse(welcome as string).params.codec).toBe(CBOR);
    expect(client.codec).toBe(CBOR);
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    const res = await client.request<"echo", { echoed: { data: Uint8Array } }>(
      "echo",
      { data: bytes },
    );
    // Réponse corrélée à la requête, octets rendus en `Uint8Array` intact.
    expect(res.echoed.data).toBeInstanceOf(Uint8Array);
    expect([...res.echoed.data]).toEqual([...bytes]);
    expect(server.sent.slice(1).every((f) => f instanceof Uint8Array)).toBe(
      true,
    );
  });

  it("client CBOR ↔ serveur CBOR : une RpcError traverse le codec, code et data fidèles", async () => {
    const { client } = await connect(true, `${CBOR}, ${TEXT}`);
    let err: unknown = null;
    try {
      await client.request("fail");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(-32000);
    expect((err as RpcError).data).toEqual({ status: 409 });
  });

  it("client CBOR ↔ serveur SANS codec : le texte est choisi, l'accueil ne porte pas `codec`", async () => {
    getRealtimeHub().setFrameCodec();
    const { client, server } = await connect(true, `${CBOR}, ${TEXT}`);
    expect(server.selected).toEqual([TEXT]);
    expect(JSON.parse(server.sent[0] as string).params).not.toHaveProperty(
      "codec",
    );
    expect(client.codec).toBe(TEXT);
    const res = await client.request<"echo", { echoed: number }>("echo", 7);
    expect(res.echoed).toBe(7);
    expect(server.sent.every((f) => typeof f === "string")).toBe(true);
  });

  it("client sans offre ↔ serveur CBOR : rien n'est confié à l'admission, tout reste en texte", async () => {
    const { client, server, offered } = await connect(false, undefined);
    expect(offered).toBeUndefined();
    expect(server.selected).toEqual([]);
    expect(client.codec).toBe(TEXT);
    const res = await client.request<"echo", { echoed: string }>("echo", "a");
    expect(res.echoed).toBe("a");
    expect(server.sent.every((f) => typeof f === "string")).toBe(true);
  });

  it("trame CBOR illisible : aucune réponse, comptée, connexion conservée", async () => {
    const { client, server, wire } = await connect(true, `${CBOR}, ${TEXT}`);
    const before = server.sent.length;
    // Tronquée : une carte de longueur indéfinie jamais refermée (RFC 8949 §3.2.2).
    wire.deliverToServer(new Uint8Array([0xbf, 0x61]));
    await flush();
    expect(server.sent.length).toBe(before);
    expect(server.malformed()).toBe(1);
    // La connexion sert toujours.
    const res = await client.request<"echo", { echoed: boolean }>("echo", true);
    expect(res.echoed).toBe(true);
  });

  it("sous codec binaire, le flux brut est fermé dans les deux sens", async () => {
    const { server, wire } = await connect(true, `${CBOR}, ${TEXT}`);
    // Entrant : une frame CBOR valide n'atteint jamais le crochet brut.
    wire.deliverToServer(
      SERVER_CBOR.encode({
        jsonrpc: "2.0",
        method: "nope",
      }) as Uint8Array<ArrayBuffer>,
    );
    await flush();
    expect(server.rt.rawFrames).toEqual([]);
    // Sortant : refusé, rien n'est écrit.
    const before = server.sent.length;
    expect(server.rt.pushRaw(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(server.sent.length).toBe(before);
  });

  it("connexion TEXTE : le flux brut sert comme avant", async () => {
    getRealtimeHub().setFrameCodec();
    const { server, wire } = await connect(false, undefined);
    wire.deliverToServer(new Uint8Array([9, 8, 7]));
    await flush();
    expect(server.rt.rawFrames.map((f) => [...f])).toEqual([[9, 8, 7]]);
    expect(server.rt.pushRaw(new Uint8Array([1]))).toBe(true);
  });
});
