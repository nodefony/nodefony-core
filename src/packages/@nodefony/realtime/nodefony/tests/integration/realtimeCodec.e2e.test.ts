import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { RealtimeInboundHandler } from "../../interfaces/IRealtimeController.js";
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
 * sur un vrai serveur WebSocket : `realtimeCodecServer.e2e` (lot `test:cluster`).
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

  /** Charges reçues par le canal entrant `upload` — telles que le handler les voit. */
  readonly inbound: unknown[] = [];

  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return { upload: (params) => void this.inbound.push(params) };
  }

  // Annoncé à l'accueil, sous réserve de la sonde des canaux (porte B2).
  override realtimeChannels(): string[] {
    return ["tick"];
  }

  // Canal de diffusion : le banc publie lui-même par le hub. `nodefony:bench`
  // A un producteur : seul le plancher de la plateforme peut le refuser.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return channel === "tick" || channel === "nodefony:bench" ? () => {} : null;
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
  /** Protocole du codec confié au traceur WS (`frameCodec`), `undefined` si aucun. */
  tracedCodec: () => string | undefined;
  /** Trames sortantes confiées au traceur WS (`outboundTracer`). */
  traced: unknown[];
}

function makeServer(
  wire: LoopbackWire,
  offer: string | undefined,
): IServerSide {
  const selected: (string | false)[] = [];
  const sent: RealtimeFrameData[] = [];
  const traced: unknown[] = [];
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
    // Traceur hors production : collecte ce que le serveur lui confie.
    outboundTracer: () => (data: unknown) => traced.push(data),
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
    // Lu par le traceur WS hors production : posé par la bascule de codec.
    frameCodec: null as { protocol: string } | null,
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
    tracedCodec: () => ctx.frameCodec?.protocol,
    traced,
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
    // Le traceur WS décode désormais les trames binaires de cette connexion.
    expect(server.tracedCodec()).toBe(CBOR);
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
    // Trace sortante : la RÉPONSE seule (frame à `id`), jamais l'accueil, qui
    // est une notification.
    expect(server.traced).toHaveLength(1);
    expect(server.traced[0]).toBe(server.sent[server.sent.length - 1]);
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
    const welcome = JSON.parse(server.sent[0] as string).params;
    expect(welcome).not.toHaveProperty("codec");
    // Serveur sans codec : il n'émet pas la convention, il ne l'annonce pas.
    expect(welcome).not.toHaveProperty("bytes");
    expect(client.codec).toBe(TEXT);
    expect(server.tracedCodec()).toBeUndefined();
    const res = await client.request<"echo", { echoed: number }>("echo", 7);
    expect(res.echoed).toBe(7);
    expect(server.sent.every((f) => typeof f === "string")).toBe(true);
  });

  it("client sans offre ↔ serveur CBOR : rien n'est confié à l'admission, tout reste en texte", async () => {
    const { client, server, offered } = await connect(false, undefined);
    expect(offered).toBeUndefined();
    expect(server.selected).toEqual([]);
    expect(client.codec).toBe(TEXT);
    // Le serveur émet la convention d'octets sur ce texte : il l'annonce, et le
    // client sans codec relit des `Uint8Array` sans rien avoir importé.
    expect(JSON.parse(server.sent[0] as string).params.bytes).toBe("$bytes");
    const res = await client.request<"echo", { echoed: string }>("echo", "a");
    expect(res.echoed).toBe("a");
    const bytes = await client.request<"echo", { echoed: Uint8Array }>(
      "echo",
      new Uint8Array([4, 0, 255]),
    );
    expect(bytes.echoed).toBeInstanceOf(Uint8Array);
    expect([...bytes.echoed]).toEqual([4, 0, 255]);
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
    // Visible dans la sonde du hub, pas seulement sur la connexion.
    expect(getRealtimeHub().probe().malformedDiscardedTotal).toBe(1);
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

  it("diffusion à un client CBOR et à un client texte : chacun reçoit la trame de SON codec", async () => {
    const cbor = await connect(true, `${CBOR}, ${TEXT}`);
    const text = await connect(false, undefined);
    const gotCbor: Array<{ seq: number; data: Uint8Array }> = [];
    const gotText: Array<{ seq: number }> = [];
    cbor.client.on("tick", (p) =>
      gotCbor.push(p as { seq: number; data: Uint8Array }),
    );
    text.client.on("tick", (p) => gotText.push(p as { seq: number }));
    cbor.client.subscribe("tick");
    text.client.subscribe("tick");
    await flush();
    await flush();
    const fromCbor = cbor.server.sent.length;
    const fromText = text.server.sent.length;
    // Deux abonnés : la frame est mutualisée par le hub, encodée par codec.
    getRealtimeHub().publish("tick", {
      seq: 7,
      data: new Uint8Array([1, 2, 3]),
    });
    await flush();
    const cborFrames = cbor.server.sent.slice(fromCbor);
    const textFrames = text.server.sent.slice(fromText);
    expect(cborFrames).toHaveLength(1);
    expect(cborFrames[0]).toBeInstanceOf(Uint8Array);
    expect(textFrames).toHaveLength(1);
    expect(typeof textFrames[0]).toBe("string");
    expect(gotCbor).toHaveLength(1);
    expect(gotCbor.map((p) => [p.seq, [...p.data]])).toEqual([[7, [1, 2, 3]]]);
    expect(gotText.map((p) => p.seq)).toEqual([7]);
    // Une diffusion de canal n'est jamais tracée (volume, boucle du journal).
    expect(cbor.server.traced).toEqual([]);
    expect(text.server.traced).toEqual([]);
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

/** Trames émises par le serveur APRÈS l'accueil, décodées selon leur opcode. */
function framesAfterWelcome(s: IServerSide): Array<Record<string, unknown>> {
  return s.sent
    .slice(1)
    .map(
      (f) =>
        (f instanceof Uint8Array
          ? SERVER_CBOR.decode(f)
          : JSON.parse(f as string)) as Record<string, unknown>,
    );
}

/** Canaux nommés par les refus (`realtime:denied`) poussés au client. */
function deniedChannels(s: IServerSide): string[] {
  return framesAfterWelcome(s)
    .filter((f) => f.method === "realtime:denied")
    .map((f) => (f.params as { channel: string }).channel);
}

describe("Portes B1 à B4 sous codec binaire — des octets passent les MÊMES contrôles que le texte (#618, ADR-0022 §3)", () => {
  beforeEach(() => {
    const hub = getRealtimeHub();
    hub.clear();
    hub.setFrameCodec(SERVER_CBOR);
  });
  afterEach(() => getRealtimeHub().clear());

  it("B1 — le verrou lit la trame DÉCODÉE, octets en `Uint8Array`, et son refus tient : le handler ne reçoit rien", async () => {
    const { client, server } = await connect(true, `${CBOR}, ${TEXT}`);
    const seen: unknown[] = [];
    getRealtimeHub().setFrameAuthorizer((frame) => {
      seen.push(frame);
      return false;
    });
    client.emit("upload", { data: new Uint8Array([1, 2, 3]) });
    await flush();
    expect(server.rt.inbound).toEqual([]);
    expect(seen).toHaveLength(1);
    // Le verrou voit ce que verrait le handler : jamais une forme encodée à part.
    const data = (seen[0] as { params: { data: unknown } }).params.data;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data instanceof Uint8Array ? [...data] : null).toEqual([1, 2, 3]);
  });

  it("B2 — plancher de la plateforme : un canal réservé, pourtant produit, est refusé à une connexion CBOR", async () => {
    const { client, server } = await connect(true, `${CBOR}, ${TEXT}`);
    client.subscribe("nodefony:bench");
    await flush();
    await flush();
    expect(deniedChannels(server)).toEqual(["nodefony:bench"]);
    expect(
      framesAfterWelcome(server).some(
        (f) => f.method === "realtime:subscribed",
      ),
    ).toBe(false);
  });

  it("B2 — la sonde des canaux annoncés filtre l'accueil d'une connexion CBOR", async () => {
    getRealtimeHub().setFrameAuthorizer(() => true, {
      silentProbe: (frame) =>
        (frame as { params: { channel: string } }).params.channel !== "tick",
    });
    const { server } = await connect(true, `${CBOR}, ${TEXT}`);
    const welcome = JSON.parse(server.sent[0] as string) as {
      params: { codec: string; channels: string[] };
    };
    expect(welcome.params.codec).toBe(CBOR);
    expect(welcome.params.channels).not.toContain("tick");
  });

  it("B3 — un refus se DIT : `realtime:denied` part en trame BINAIRE et nomme le canal", async () => {
    const { client, server } = await connect(true, `${CBOR}, ${TEXT}`);
    getRealtimeHub().setFrameAuthorizer(() => false);
    const before = server.sent.length;
    client.emit("upload", { data: new Uint8Array([7]) });
    await flush();
    const out = server.sent.slice(before);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(Uint8Array);
    expect(deniedChannels(server)).toEqual(["upload"]);
  });

  it("B4 — la sonde compte la trame d'octets entrante, livrée intacte au handler", async () => {
    const { client, server } = await connect(true, `${CBOR}, ${TEXT}`);
    client.emit("upload", { data: new Uint8Array([0, 255]) });
    await flush();
    const got = server.rt.inbound as Array<{ data: Uint8Array }>;
    expect(got).toHaveLength(1);
    expect(got[0]?.data).toBeInstanceOf(Uint8Array);
    expect([...(got[0]?.data ?? [])]).toEqual([0, 255]);
    expect(getRealtimeHub().probe().inboundTotal).toBe(1);
  });

  it("`clear()` retire la sonde des canaux AVEC le verrou — posés ensemble, ils tombent ensemble", async () => {
    const hub = getRealtimeHub();
    hub.setFrameAuthorizer(() => true, { silentProbe: () => false });
    hub.clear();
    hub.setFrameCodec(SERVER_CBOR);
    const { server } = await connect(true, `${CBOR}, ${TEXT}`);
    const welcome = JSON.parse(server.sent[0] as string) as {
      params: { channels: string[] };
    };
    // Sonde orpheline : elle masquerait encore `tick` sans aucun verrou posé.
    expect(welcome.params.channels).toContain("tick");
  });
});
