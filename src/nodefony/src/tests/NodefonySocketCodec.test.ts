import { afterEach, describe, expect, it, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import type { NodefonyNotice } from "../client/realtime/notice";
import {
  describeCodec,
  describeSocket,
  socketSnapshot,
} from "../client/realtime/snapshot";
import { BrowserWsTransport } from "../client/realtime/BrowserWsTransport";
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
  type RealtimeOutboundData,
} from "../realtime/IRealtimeTransport";
import { JSON_PROTOCOL, type IFrameCodec } from "../realtime/IFrameCodec";
import {
  BYTES_MARKER,
  JSON_BYTES_FRAME_CODEC,
  JSON_FRAME_CODEC,
} from "../realtime/jsonFrameCodec";
import {
  adoptFrameCodec,
  frameCodecSet,
  negotiateFrameCodec,
} from "../realtime/frameCodecNegotiation";
import { CBOR_PROTOCOL, decodeCbor, encodeCbor } from "../realtime/codec/index";
import { CBOR_FRAME_CODEC } from "../realtime/codec/frameCodec";
import { toBase64Url } from "../realtime/base64url";

/**
 * #618 lot 2 — le client NEGOCIE son codec de frame (ADR-0022 §2) : il offre, le
 * serveur choisit et l'annonce dans l'accueil, le client adopte. La règle est
 * partagée avec le serveur (`frameCodecNegotiation.ts`) : les tests du bloc pur
 * valent pour les deux bouts.
 */

/** Transport factice : capte l'offre, les trames texte et binaires. */
class CodecTransport implements IRealtimeTransport {
  text: string[] = [];
  binary: Uint8Array[] = [];
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;

  constructor(readonly protocols: readonly string[] | undefined) {}

  connect(): void {}
  send(raw: RealtimeOutboundData): void {
    if (typeof raw === "string") this.text.push(raw);
    else this.binary.push(raw);
  }
  close(code?: number, reason?: string): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code ?? 1000, reason ?? "");
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(): void {}
  /** Ouvre, puis l'accueil TEXTE `v1` qu'émet le serveur — avec ou sans `codec`. */
  open(welcome: Record<string, unknown> = {}): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
    this.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: {
          ts: 1,
          protocol: "jsonrpc-2.0",
          channels: [],
          methods: [],
          ...welcome,
        },
      }),
    );
  }
  receive(raw: RealtimeFrameData): void {
    this._onMessage?.(raw);
  }
  drop(code = 1006): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, "");
  }
}

function setup(codec?: IFrameCodec) {
  const transports: CodecTransport[] = [];
  const client = new NodefonySocket(
    { url: "ws://x/realtime", codec, banner: false, probe: false },
    (_url, protocols) => {
      const t = new CodecTransport(protocols);
      transports.push(t);
      return t;
    },
  );
  const notices: NodefonyNotice[] = [];
  client.onNotice((n) => notices.push(n));
  return { client, transports, notices };
}

async function connected(
  codec?: IFrameCodec,
  welcome: Record<string, unknown> = {},
) {
  const s = setup(codec);
  const p = s.client.connect();
  s.transports[0]!.open(welcome);
  await p;
  return { ...s, transport: s.transports[0]! };
}

/** Une notification serveur → client, encodée en CBOR comme le fera le serveur. */
function cborNotification(
  method: string,
  params: unknown,
): Uint8Array<ArrayBuffer> {
  return encodeCbor({ jsonrpc: "2.0", method, params });
}

describe("négociation du codec — règle pure, partagée client/serveur", () => {
  it("sans codec : JSON natif, aucune offre — et le MÊME jeu à chaque appel (zéro allocation)", () => {
    const set = frameCodecSet();
    expect(set.text).to.equal(JSON_FRAME_CODEC);
    expect(set.binary).to.equal(null);
    expect(set.offer).to.equal(undefined);
    expect(frameCodecSet()).to.equal(set);
  });

  it("codec binaire : offert en premier, puis v1 ; le texte arme la convention des octets", () => {
    const set = frameCodecSet(CBOR_FRAME_CODEC);
    expect(set.binary).to.equal(CBOR_FRAME_CODEC);
    expect(set.text).to.equal(JSON_BYTES_FRAME_CODEC);
    expect(set.offer).to.deep.equal([CBOR_PROTOCOL, JSON_PROTOCOL]);
  });

  it("un codec v1 remplace le texte et n'est pas offert", () => {
    const set = frameCodecSet(JSON_BYTES_FRAME_CODEC);
    expect(set.text).to.equal(JSON_BYTES_FRAME_CODEC);
    expect(set.binary).to.equal(null);
    expect(set.offer).to.equal(undefined);
  });

  it("serveur : le binaire s'il est offert, sinon le texte", () => {
    const set = frameCodecSet(CBOR_FRAME_CODEC);
    expect(negotiateFrameCodec(set, [CBOR_PROTOCOL, JSON_PROTOCOL])).to.equal(
      CBOR_FRAME_CODEC,
    );
    expect(negotiateFrameCodec(set, [JSON_PROTOCOL])).to.equal(set.text);
    expect(negotiateFrameCodec(set, [])).to.equal(set.text);
    expect(negotiateFrameCodec(set, ["nodefony.jsonrpc.protobuf.v1"])).to.equal(
      set.text,
    );
    expect(negotiateFrameCodec(frameCodecSet(), [CBOR_PROTOCOL])).to.equal(
      JSON_FRAME_CODEC,
    );
  });

  it("client : absent ou v1 → texte ; l'offert → lui ; hors offre → null", () => {
    const set = frameCodecSet(CBOR_FRAME_CODEC);
    expect(adoptFrameCodec(set, undefined)).to.equal(set.text);
    expect(adoptFrameCodec(set, JSON_PROTOCOL)).to.equal(set.text);
    expect(adoptFrameCodec(set, CBOR_PROTOCOL)).to.equal(CBOR_FRAME_CODEC);
    expect(adoptFrameCodec(set, "nodefony.jsonrpc.protobuf.v1")).to.equal(null);
    expect(adoptFrameCodec(set, 42)).to.equal(null);
    expect(adoptFrameCodec(frameCodecSet(), CBOR_PROTOCOL)).to.equal(null);
  });

  it("client en texte : `bytesMarker` annoncé → JSON à convention, sauf codec texte choisi ou marqueur inconnu", () => {
    const plain = frameCodecSet();
    // Le serveur émet la convention : le texte natif cède la place.
    expect(adoptFrameCodec(plain, undefined, BYTES_MARKER)).to.equal(
      JSON_BYTES_FRAME_CODEC,
    );
    expect(adoptFrameCodec(plain, JSON_PROTOCOL, BYTES_MARKER)).to.equal(
      JSON_BYTES_FRAME_CODEC,
    );
    // Sans annonce, ou marqueur inconnu : le fil d'avant les codecs.
    expect(adoptFrameCodec(plain, undefined)).to.equal(JSON_FRAME_CODEC);
    expect(adoptFrameCodec(plain, undefined, "$octets")).to.equal(
      JSON_FRAME_CODEC,
    );
    // Un codec texte choisi par l'application n'est jamais remplacé.
    const custom: IFrameCodec = { ...JSON_FRAME_CODEC };
    expect(
      adoptFrameCodec(frameCodecSet(custom), undefined, BYTES_MARKER),
    ).to.equal(custom);
    // Le binaire retenu prime : le marqueur ne concerne que le texte.
    const cbor = frameCodecSet(CBOR_FRAME_CODEC);
    expect(adoptFrameCodec(cbor, CBOR_PROTOCOL, BYTES_MARKER)).to.equal(
      CBOR_FRAME_CODEC,
    );
  });

  it("aller-retour : offre → choix → annonce → adoption, les deux bouts parlent le MÊME format", () => {
    for (const clientCodec of [undefined, CBOR_FRAME_CODEC]) {
      for (const serverCodec of [undefined, CBOR_FRAME_CODEC]) {
        const client = frameCodecSet(clientCodec);
        const server = frameCodecSet(serverCodec);
        const chosen = negotiateFrameCodec(server, client.offer ?? []);
        // Un serveur qui reste en texte peut taire le champ : les deux formes valent.
        for (const announced of [
          chosen.protocol,
          chosen.protocol === JSON_PROTOCOL ? undefined : chosen.protocol,
        ]) {
          const adopted = adoptFrameCodec(client, announced);
          expect(
            adopted,
            `${clientCodec?.protocol}/${serverCodec?.protocol}`,
          ).to.not.equal(null);
          expect(adopted?.protocol).to.equal(chosen.protocol);
        }
        const binary = clientCodec !== undefined && serverCodec !== undefined;
        expect(chosen.protocol).to.equal(
          binary ? CBOR_PROTOCOL : JSON_PROTOCOL,
        );
      }
    }
  });
});

describe("NodefonySocket — sans codec : le fil d'avant, octet pour octet", () => {
  it("aucune offre de sous-protocole, frames en JSON natif, format v1", async () => {
    const { client, transport } = await connected();
    expect(transport.protocols).to.equal(undefined);
    expect(client.codec).to.equal(JSON_PROTOCOL);
    client.subscribe("c");
    expect(transport.text.at(-1)).to.equal(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: "c" },
      }),
    );
    expect(transport.binary).to.have.length(0);
    client.disconnect();
  });

  it("accueil qui annonce `bytesMarker` → les octets d'une charge arrivent en Uint8Array, sans rien importer", async () => {
    const { client, transport } = await connected(undefined, {
      bytesMarker: BYTES_MARKER,
    });
    expect(client.codec).to.equal(JSON_PROTOCOL);
    const got: unknown[] = [];
    client.on("c", (p) => got.push(p));
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "c",
        params: {
          b: { [BYTES_MARKER]: toBase64Url(new Uint8Array([1, 255])) },
        },
      }),
    );
    expect(got).to.have.length(1);
    const b = (got[0] as { b: unknown }).b;
    expect(b).to.be.instanceOf(Uint8Array);
    expect([...(b as Uint8Array)]).to.deep.equal([1, 255]);
    // Dans l'autre sens, la même convention : le serveur la relit.
    client.publish("c", { b: new Uint8Array([7]) });
    expect(JSON.parse(transport.text.at(-1)!)).to.deep.equal({
      jsonrpc: "2.0",
      method: "c",
      params: { b: { [BYTES_MARKER]: toBase64Url(new Uint8Array([7])) } },
    });
    client.disconnect();
  });

  it("accueil SANS `bytesMarker` : un objet applicatif `$bytes` reste un objet", async () => {
    const { client, transport } = await connected();
    const got: unknown[] = [];
    client.on("c", (p) => got.push(p));
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "c",
        params: { b: { [BYTES_MARKER]: "AQL_" } },
      }),
    );
    expect(got).to.deep.equal([{ b: { [BYTES_MARKER]: "AQL_" } }]);
    client.disconnect();
  });

  it("un accueil qui annonce un codec NON offert → notice d'erreur, la connexion reste en texte", async () => {
    const { client, notices } = await connected(undefined, {
      codec: CBOR_PROTOCOL,
    });
    expect(client.codec).to.equal(JSON_PROTOCOL);
    const fautes = notices.filter(
      (n) => n.level === "error" && n.message.includes(CBOR_PROTOCOL),
    );
    expect(fautes).to.have.length(1);
    client.disconnect();
  });
});

describe("NodefonySocket — codec CBOR offert et retenu", () => {
  it("offre [cbor, v1] au handshake ; tout est texte jusqu'à l'accueil", () => {
    const { client, transports } = setup(CBOR_FRAME_CODEC);
    void client.connect().catch(() => undefined);
    expect(transports[0]!.protocols).to.deep.equal([
      CBOR_PROTOCOL,
      JSON_PROTOCOL,
    ]);
    expect(client.codec).to.equal(JSON_PROTOCOL);
    client.disconnect();
  });

  it("l'accueil annonce cbor → le rejeu des abonnements part DÉJÀ en CBOR binaire", async () => {
    const { client, transports } = setup(CBOR_FRAME_CODEC);
    client.subscribe("doc:1");
    const p = client.connect();
    const t = transports[0]!;
    t.open({ codec: CBOR_PROTOCOL });
    await p;
    expect(client.codec).to.equal(CBOR_PROTOCOL);
    expect(t.text).to.have.length(0);
    expect(t.binary).to.have.length(1);
    expect(decodeCbor(t.binary[0]!)).to.deep.equal({
      jsonrpc: "2.0",
      method: "subscribe",
      params: { channel: "doc:1" },
    });
    client.disconnect();
  });

  it("on(canal) reçoit les octets d'une charge en Uint8Array, intacts, sans base64", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const recus: unknown[] = [];
    client.on("doc:1", (p) => recus.push(p));
    const delta = new Uint8Array([0, 1, 2, 250, 255]);
    transport.receive(cborNotification("doc:1", { delta, rev: 7 }));
    expect(recus).to.have.length(1);
    const recu = recus[0] as { delta: unknown; rev: number };
    expect(recu.delta).to.be.instanceOf(Uint8Array);
    expect(Array.from(recu.delta as Uint8Array)).to.deep.equal([
      0, 1, 2, 250, 255,
    ]);
    expect(recu.rev).to.equal(7);
    expect(client.binaryFramesDiscarded).to.equal(0);
    client.disconnect();
  });

  it("publish d'octets → une frame CBOR binaire, octets en chaîne native (type majeur 2)", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const octets = new Uint8Array([9, 8, 7]);
    client.publish("doc:1", { octets });
    const frame = decodeCbor(transport.binary.at(-1)!) as {
      params: { octets: Uint8Array };
    };
    expect(frame.params.octets).to.be.instanceOf(Uint8Array);
    expect(Array.from(frame.params.octets)).to.deep.equal([9, 8, 7]);
    // Chaîne d'octets CBOR : en-tête 0x43 (type 2, longueur 3) suivi des octets bruts.
    const brut = Array.from(transport.binary.at(-1)!);
    const i = brut.indexOf(0x43);
    expect(brut.slice(i, i + 4)).to.deep.equal([0x43, 9, 8, 7]);
    client.disconnect();
  });

  it("tolère une trame TEXTE après l'accueil (convention $bytes comprise)", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const recus: unknown[] = [];
    client.on("c", (p) => recus.push(p));
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "c",
        params: { b: { [BYTES_MARKER]: toBase64Url(new Uint8Array([5])) } },
      }),
    );
    expect((recus[0] as { b: Uint8Array }).b).to.be.instanceOf(Uint8Array);
    client.disconnect();
  });

  it("trame binaire illisible pour le codec → comptée malformée, UNE notice qui nomme le codec", async () => {
    const { client, transport, notices } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    transport.receive(new Uint8Array([0xff, 0xff]));
    transport.receive(new Uint8Array([0x1f]));
    expect(client.malformedFramesDiscarded).to.equal(2);
    expect(client.binaryFramesDiscarded).to.equal(0);
    const illisibles = notices.filter((n) => n.message.includes("illisible"));
    expect(illisibles).to.have.length(1);
    expect(illisibles[0]!.message).to.include(CBOR_PROTOCOL);
    client.disconnect();
  });

  it("flux brut sous CBOR : sendBinary refusé, onBinary inactif — UNE notice par connexion", async () => {
    const { client, transport, notices } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const bruts: Uint8Array[] = [];
    client.onBinary((d) => bruts.push(d));
    expect(client.sendBinary(new Uint8Array([1]))).to.equal(false);
    expect(client.sendBinary(new Uint8Array([2]))).to.equal(false);
    expect(transport.binary).to.have.length(0);
    expect(client.framesUnsent).to.equal(0);
    // Une trame binaire est une frame du codec, jamais remise au flux brut.
    transport.receive(cborNotification("c", { x: 1 }));
    expect(bruts).to.have.length(0);
    expect(
      notices.filter((n) => n.message.includes("Flux binaire brut")),
    ).to.have.length(1);
    client.disconnect();
  });

  it("lecteur onBinary posé AVANT un accueil cbor → signalé à l'accueil", async () => {
    const { client, transports, notices } = setup(CBOR_FRAME_CODEC);
    client.onBinary(() => undefined);
    const p = client.connect();
    transports[0]!.open({ codec: CBOR_PROTOCOL });
    await p;
    expect(
      notices.filter((n) => n.message.includes("Flux binaire brut")),
    ).to.have.length(1);
    client.disconnect();
  });

  it("coupure : retour au texte jusqu'à l'accueil suivant ; disconnect → texte", async () => {
    vi.useFakeTimers();
    try {
      const { client, transports } = setup(CBOR_FRAME_CODEC);
      const p = client.connect();
      transports[0]!.open({ codec: CBOR_PROTOCOL });
      await p;
      expect(client.codec).to.equal(CBOR_PROTOCOL);
      transports[0]!.drop(1006);
      await vi.advanceTimersByTimeAsync(60_000);
      const t2 = transports[1]!;
      expect(t2.protocols).to.deep.equal([CBOR_PROTOCOL, JSON_PROTOCOL]);
      expect(client.codec).to.equal(JSON_PROTOCOL);
      t2.open({ codec: CBOR_PROTOCOL });
      expect(client.codec).to.equal(CBOR_PROTOCOL);
      client.disconnect();
      expect(client.codec).to.equal(JSON_PROTOCOL);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NodefonySocket — codec offert, serveur resté en texte", () => {
  it("accueil sans champ codec → texte, octets publiés sous la convention $bytes", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC);
    expect(client.codec).to.equal(JSON_PROTOCOL);
    client.publish("c", { b: new Uint8Array([1, 2]) });
    expect(transport.binary).to.have.length(0);
    expect(JSON.parse(transport.text.at(-1)!)).to.deep.equal({
      jsonrpc: "2.0",
      method: "c",
      params: { b: { [BYTES_MARKER]: toBase64Url(new Uint8Array([1, 2])) } },
    });
    client.disconnect();
  });

  it("le flux brut reste disponible sur une connexion texte", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC);
    const bruts: Uint8Array[] = [];
    client.onBinary((d) => bruts.push(d));
    transport.receive(new Uint8Array([3]));
    expect(bruts).to.have.length(1);
    expect(client.sendBinary(new Uint8Array([4]))).to.equal(true);
    client.disconnect();
  });
});

describe("NodefonySocket — journal, instantané et diagnostic disent le format", () => {
  it("frame binaire journalisée : binary, taille en octets, octets résumés jamais énumérés", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const gros = new Uint8Array(4096);
    const raw = cborNotification("doc:1", { delta: gros });
    transport.receive(raw);
    const f = client.frameLog.at(-1)!;
    expect(f.binary).to.equal(true);
    expect(f.size).to.equal(raw.byteLength);
    expect(f.payload).to.deep.equal({
      jsonrpc: "2.0",
      method: "doc:1",
      params: { delta: "[binary 4096 B]" },
    });
    const welcome = client.frameLog.find((x) => x.kind === "realtime:welcome")!;
    expect(welcome.binary).to.equal(false);
    client.disconnect();
  });

  it("trame binaire démesurée → résumé en OCTETS, hors budget", async () => {
    const { client, transport } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    transport.receive(
      cborNotification("doc:1", { delta: new Uint8Array(70_000) }),
    );
    const f = client.frameLog.at(-1)!;
    expect(f.payload)
      .to.have.property("truncated")
      .that.matches(/^\d+ octets/);
    client.disconnect();
  });

  it("anneau O(1) : au-delà de 300 trames, les plus anciennes sortent, l'ordre tient", async () => {
    const { client, transport } = await connected();
    for (let i = 0; i < 450; i++)
      transport.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "c", params: { i } }),
      );
    const log = client.frameLog;
    expect(log).to.have.length(300);
    expect((log[0]!.payload as { params: { i: number } }).params.i).to.equal(
      150,
    );
    expect(
      (log.at(-1)!.payload as { params: { i: number } }).params.i,
    ).to.equal(449);
    client.clearFrameLog();
    expect(client.frameLog).to.have.length(0);
    client.disconnect();
  });

  it("anneau plein : la trame évincée quitte AUSSI le budget (sinon le journal fond tout seul)", async () => {
    const { client, transport } = await connected();
    // 400 × ~6 000 caractères : 300 retenues ≈ 1,8 Mo, sous le budget de 2 Mo.
    // Un coût évincé mais resté compté ferait croire 2,4 Mo, et sortir ~70 trames de trop.
    const charge = "x".repeat(6000);
    for (let i = 0; i < 400; i++)
      transport.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "c", params: { i, charge } }),
      );
    expect(client.frameLog).to.have.length(300);
    client.disconnect();
  });

  it("instantané et description : la ligne « format » suit le codec retenu", async () => {
    const { client } = await connected(CBOR_FRAME_CODEC, {
      codec: CBOR_PROTOCOL,
    });
    const snap = socketSnapshot(client);
    expect(snap.codec).to.equal(CBOR_PROTOCOL);
    const row = describeSocket(snap).find((r) => r.label === "format");
    expect(row?.value).to.equal(`JSON-RPC 2.0 · binaire (${CBOR_PROTOCOL})`);
    expect(describeCodec(JSON_PROTOCOL)).to.equal(
      `JSON-RPC 2.0 · texte (${JSON_PROTOCOL})`,
    );
    client.disconnect();
  });
});

describe("NodefonySocket.shared — un codec ignoré se dit", () => {
  afterEach(() => {
    const g = globalThis as { __nfRealtime__?: Map<string, NodefonySocket> };
    g.__nfRealtime__?.clear();
    vi.restoreAllMocks();
  });

  it("socket déjà créée sans codec : la seconde demande avertit en développement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = NodefonySocket.shared({ url: "ws://x/partagee", banner: false });
    const b = NodefonySocket.shared({
      url: "ws://x/partagee",
      codec: CBOR_FRAME_CODEC,
    });
    expect(b).to.equal(a);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).to.include(CBOR_PROTOCOL);
    // Même codec redemandé : rien à dire.
    NodefonySocket.shared({ url: "ws://x/partagee" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("BrowserWsTransport — offre de sous-protocoles", () => {
  class FakeWebSocket extends EventTarget {
    static calls: unknown[][] = [];
    binaryType: BinaryType = "blob";
    readyState = TransportState.OPEN;
    constructor(...args: unknown[]) {
      super();
      FakeWebSocket.calls.push(args);
    }
    send(): void {}
    close(): void {}
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.calls = [];
  });

  it("sans offre : le constructeur reçoit l'URL seule ; avec : une COPIE mutable de l'offre", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    new BrowserWsTransport("ws://x").connect();
    expect(FakeWebSocket.calls[0]).to.deep.equal(["ws://x"]);
    const offre = Object.freeze([CBOR_PROTOCOL, JSON_PROTOCOL]);
    new BrowserWsTransport("ws://x", offre).connect();
    const passee = FakeWebSocket.calls[1]![1];
    expect(passee).to.deep.equal([CBOR_PROTOCOL, JSON_PROTOCOL]);
    expect(passee).to.not.equal(offre);
  });
});
