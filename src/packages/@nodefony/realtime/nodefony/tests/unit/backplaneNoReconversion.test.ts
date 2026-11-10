import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CBOR_FRAME_CODEC, decodeCbor, encodeCbor } from "nodefony/cbor";
import type { IFrameCodec } from "nodefony";
import {
  BackplaneEcho,
  openBackplaneEnvelope,
  openBackplaneEnvelopeBytes,
  sealBackplaneEnvelope,
  sealBackplaneEnvelopeBytes,
} from "../../src/backplane/envelope.js";
import { BackplaneIngress } from "../../src/backplane/ingress.js";
import { RedisBackplane } from "../../src/backplane/RedisBackplane.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";
import { FakeRedisBus } from "../helpers/fakeRedisBus.js";

/**
 * Aucune reconversion de la charge sur le bus (ADR-0021 S6, #760 lot B) : le
 * sceau se vérifie sur la tranche REÇUE, la charge binaire s'encode UNE fois, et
 * l'écho se reconnaît à la fin du message sans le décoder. Format inchangé : les
 * octets de référence vivent dans `backplaneEnvelopeGolden.test.ts`.
 */

const SECRET = "bus-secret";
const ME = "pod-a.1";

/** Sceau d'une chaîne canonique dont la charge est donnée TELLE QUELLE. */
function sealOver(
  originId: string,
  channel: string,
  payload: string | Uint8Array,
  secret = SECRET,
): string {
  return createHmac("sha256", secret)
    .update(`${JSON.stringify(originId)}\n${JSON.stringify(channel)}\n`)
    .update(payload)
    .digest("base64url");
}

/** Codec CBOR qui compte ses encodages et décodages. */
function countingCbor(): {
  codec: IFrameCodec;
  calls: { encode: number; decode: number };
} {
  const calls = { encode: 0, decode: 0 };
  const codec: IFrameCodec = {
    protocol: CBOR_FRAME_CODEC.protocol,
    encode(v: unknown) {
      calls.encode += 1;
      return CBOR_FRAME_CODEC.encode(v);
    },
    decode(d: string | Uint8Array) {
      calls.decode += 1;
      return CBOR_FRAME_CODEC.decode(d);
    },
  };
  return { codec, calls };
}

/** Assemble une enveloppe CBOR scellée à la main, charge donnée en octets bruts. */
function cborEnvelope(
  channel: string,
  payloadBytes: Uint8Array,
  originId: string,
  sig: string,
): Uint8Array {
  return Buffer.concat([
    Uint8Array.of(0xa4),
    encodeCbor("channel"),
    encodeCbor(channel),
    encodeCbor("payload"),
    payloadBytes,
    encodeCbor("originId"),
    encodeCbor(originId),
    encodeCbor("sig"),
    encodeCbor(sig),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("voie texte — sceau vérifié sur la tranche reçue", () => {
  it("une charge écrite sous une forme non canonique, scellée sur ses octets, s'ouvre", () => {
    // Une re-sérialisation rendrait `{"a":1,"b":[1]}` : le sceau ne correspondrait plus.
    const payload = '{"a":1.0,"b" : [ 1 ]}';
    const raw = `{"channel":"c","payload":${payload},"originId":"pod-b","sig":"${sealOver("pod-b", "c", payload)}"}`;
    expect(openBackplaneEnvelope(raw, SECRET)).toEqual({
      channel: "c",
      payload: { a: 1, b: [1] },
      originId: "pod-b",
    });
  });

  it("repli : une forme tierce (autre ordre de clés), scellée sur la forme canonique, s'ouvre encore", () => {
    const raw = `{"originId":"pod-b","sig":"${sealOver("pod-b", "c", '{"a":1}')}","channel":"c","payload":{"a":1}}`;
    expect(openBackplaneEnvelope(raw, SECRET)).toEqual({
      channel: "c",
      payload: { a: 1 },
      originId: "pod-b",
    });
  });

  it("une tranche altérée est refusée, repli compris", () => {
    const raw = sealBackplaneEnvelope(
      { channel: "c", payload: { n: 1 }, originId: "pod-b" },
      SECRET,
    );
    expect(openBackplaneEnvelope(raw.replace('"n":1', '"n":2'), SECRET)).toBe(
      null,
    );
  });

  it("à la réception, la charge n'est jamais re-sérialisée", () => {
    const payload = { list: [1, 2, 3], text: "é" };
    const raw = sealBackplaneEnvelope(
      { channel: "c", payload, originId: "pod-b" },
      SECRET,
    );
    const stringify = vi.spyOn(JSON, "stringify");
    expect(openBackplaneEnvelope(raw, SECRET)?.payload).toEqual(payload);
    // Seuls les champs courts (canal, origine) passent par `JSON.stringify`.
    for (const [value] of stringify.mock.calls)
      expect(typeof value, "charge re-sérialisée").toBe("string");
  });
});

describe("voie binaire — charge encodée une fois, vérifiée sur la tranche reçue", () => {
  const msg: IBackplaneMessage = {
    channel: "capteur:raw",
    payload: { seq: 7, raw: new Uint8Array([0, 1, 255]) },
    originId: "pod-b",
  };

  it("scellée, la charge est encodée UNE fois à l'envoi, au même format", () => {
    const { codec, calls } = countingCbor();
    sealBackplaneEnvelopeBytes(msg, codec, SECRET); // première fois : épreuve du codec
    calls.encode = 0;
    const wire = sealBackplaneEnvelopeBytes(msg, codec, SECRET);
    expect(calls.encode).toBe(1);
    // Format inchangé : les octets du codec pour l'enveloppe entière.
    const env = decodeCbor(wire);
    expect(Buffer.from(encodeCbor(env)).equals(Buffer.from(wire))).toBe(true);
  });

  it("à la réception, la charge n'est jamais ré-encodée", () => {
    const { codec, calls } = countingCbor();
    const wire = sealBackplaneEnvelopeBytes(msg, codec, SECRET);
    calls.encode = 0;
    expect(openBackplaneEnvelopeBytes(wire, codec, SECRET)).toStrictEqual(
      structuredClone(msg),
    );
    expect(calls.encode).toBe(0);
  });

  it("une charge CBOR non canonique, scellée sur ses octets, s'ouvre", () => {
    // 5 sur deux octets (0x19 0x0005) : un ré-encodage rendrait 0x05.
    const payloadBytes = Uint8Array.of(0x19, 0x00, 0x05);
    const wire = cborEnvelope(
      "c",
      payloadBytes,
      "pod-b",
      sealOver("pod-b", "c", payloadBytes),
    );
    expect(openBackplaneEnvelopeBytes(wire, CBOR_FRAME_CODEC, SECRET)).toEqual({
      channel: "c",
      payload: 5,
      originId: "pod-b",
    });
  });

  it("un octet de la tranche altéré est refusé, repli compris", () => {
    const wire = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, SECRET);
    const forged = Uint8Array.from(wire);
    const at = Buffer.from(forged).indexOf(Uint8Array.of(0, 1, 255));
    forged[at + 1] = 2;
    expect(openBackplaneEnvelopeBytes(forged, CBOR_FRAME_CODEC, SECRET)).toBe(
      null,
    );
  });

  it("un codec binaire qui n'écrit pas ce CBOR garde la voie générique, correcte", () => {
    const jsonBytes: IFrameCodec = {
      protocol: "test.json-bytes",
      encode: (v: unknown) => new TextEncoder().encode(JSON.stringify(v)),
      decode: (d: string | Uint8Array) =>
        JSON.parse(typeof d === "string" ? d : new TextDecoder().decode(d)),
    };
    const plain = { channel: "c", payload: { a: [1, "x"] }, originId: ME };
    const wire = sealBackplaneEnvelopeBytes(plain, jsonBytes, SECRET);
    expect(openBackplaneEnvelopeBytes(wire, jsonBytes, SECRET)).toEqual(plain);
    expect(openBackplaneEnvelopeBytes(wire, jsonBytes, "autre")).toBe(null);
    expect(new BackplaneEcho(ME, SECRET).bytes(wire, jsonBytes)).toBe(false);
  });
});

describe("écho reconnu à la fin du message, sans décodage", () => {
  const channels = [
    "c",
    "",
    'piège","payload":{"x":1}',
    "é".repeat(200), // 400 octets : en-tête CBOR sur deux octets de longueur
    "x".repeat(70_000), // en-tête CBOR sur quatre octets de longueur
  ];
  const payloads = [{ n: 1 }, undefined, 'fin"}', [1, 2]];

  it("texte scellé : l'écho de ce pod est reconnu, sous toutes les formes de canal et de charge", () => {
    const echo = new BackplaneEcho(ME, SECRET);
    for (const channel of channels)
      for (const payload of payloads)
        expect(
          echo.text(
            sealBackplaneEnvelope({ channel, payload, originId: ME }, SECRET),
          ),
          `${channel.slice(0, 20)} / ${JSON.stringify(payload)}`,
        ).toBe(true);
  });

  it("binaire scellé : l'écho de ce pod est reconnu, sous toutes les formes de canal et de charge", () => {
    const echo = new BackplaneEcho(ME, SECRET);
    for (const channel of channels)
      for (const payload of payloads)
        expect(
          echo.bytes(
            sealBackplaneEnvelopeBytes(
              { channel, payload, originId: ME },
              CBOR_FRAME_CODEC,
              SECRET,
            ),
            CBOR_FRAME_CODEC,
          ),
          `${channel.slice(0, 20)} / ${JSON.stringify(payload)}`,
        ).toBe(true);
  });

  it("un autre pod, ou un écho FORGÉ (autre secret), n'est pas un écho", () => {
    const echo = new BackplaneEcho(ME, SECRET);
    const other = { channel: "c", payload: { n: 1 }, originId: "pod-b" };
    const forged = { channel: "c", payload: { n: 1 }, originId: ME };
    expect(echo.text(sealBackplaneEnvelope(other, SECRET))).toBe(false);
    expect(echo.text(sealBackplaneEnvelope(forged, "autre"))).toBe(false);
    expect(
      echo.bytes(
        sealBackplaneEnvelopeBytes(other, CBOR_FRAME_CODEC, SECRET),
        CBOR_FRAME_CODEC,
      ),
    ).toBe(false);
    expect(
      echo.bytes(
        sealBackplaneEnvelopeBytes(forged, CBOR_FRAME_CODEC, "autre"),
        CBOR_FRAME_CODEC,
      ),
    ).toBe(false);
  });

  it("bus nu : l'écho se reconnaît à son origine, sur les deux sujets", () => {
    const echo = new BackplaneEcho(ME, null);
    const mine = { channel: "c", payload: { n: 1 }, originId: ME };
    const other = { ...mine, originId: "pod-b" };
    expect(echo.text(sealBackplaneEnvelope(mine))).toBe(true);
    expect(echo.text(sealBackplaneEnvelope(other))).toBe(false);
    expect(
      echo.bytes(
        sealBackplaneEnvelopeBytes(mine, CBOR_FRAME_CODEC),
        CBOR_FRAME_CODEC,
      ),
    ).toBe(true);
    expect(
      echo.bytes(
        sealBackplaneEnvelopeBytes(other, CBOR_FRAME_CODEC),
        CBOR_FRAME_CODEC,
      ),
    ).toBe(false);
  });
});

describe("BackplaneIngress — le tri d'entrée commun aux pilotes", () => {
  it("texte : l'écho est compté sans JSON.parse ; le message d'un pair passe", () => {
    const ingress = new BackplaneIngress(ME, SECRET);
    const echo = sealBackplaneEnvelope(
      { channel: "c", payload: { n: 1 }, originId: ME },
      SECRET,
    );
    const peer = sealBackplaneEnvelope(
      { channel: "c", payload: { n: 2 }, originId: "pod-b" },
      SECRET,
    );
    const parse = vi.spyOn(JSON, "parse");
    expect(ingress.text(echo)).toBe(null);
    expect(parse).not.toHaveBeenCalled();
    expect(ingress.text(peer)?.payload).toEqual({ n: 2 });
    expect(ingress.echoTotal).toBe(1);
    expect(ingress.sealRejectedTotal).toBe(0);
  });

  it("binaire : l'écho est compté sans décodage", () => {
    const { codec, calls } = countingCbor();
    const ingress = new BackplaneIngress(ME, SECRET);
    const echo = sealBackplaneEnvelopeBytes(
      { channel: "c", payload: new Uint8Array([1]), originId: ME },
      codec,
      SECRET,
    );
    calls.decode = 0;
    expect(ingress.bytes(echo, codec)).toBe(null);
    expect(calls.decode).toBe(0);
    expect(ingress.echoTotal).toBe(1);
  });

  it("un écho forgé (autre secret) est un sceau refusé, jamais un écho", () => {
    const ingress = new BackplaneIngress(ME, SECRET);
    const forged = sealBackplaneEnvelope(
      { channel: "c", payload: 1, originId: ME },
      "autre",
    );
    expect(ingress.text(forged)).toBe(null);
    expect(ingress.echoTotal).toBe(0);
    expect(ingress.sealRejectedTotal).toBe(1);
  });

  it("un écho sous une forme tierce est reconnu après ouverture, compté, jamais remis", () => {
    const ingress = new BackplaneIngress(ME, SECRET);
    const raw = `{"originId":${JSON.stringify(ME)},"sig":"${sealOver(ME, "c", "1")}","channel":"c","payload":1}`;
    expect(ingress.text(raw)).toBe(null);
    expect(ingress.echoTotal).toBe(1);
  });
});

describe("RedisBackplane — échos comptés", () => {
  it("chaque publication revient en écho chez l'émetteur, jamais chez le pair", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(bus.transport(), "pod-a", undefined, SECRET);
    const b = new RedisBackplane(bus.transport(), "pod-b", undefined, SECRET);
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    a.onMessage((m) => gotA.push(m.payload));
    b.onMessage((m) => gotB.push(m.payload));
    await a.start();
    await b.start();
    for (let i = 0; i < 3; i += 1) a.publish("c", { i });
    expect(gotA).toEqual([]);
    expect(gotB).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
    expect(a.describe().echoTotal).toBe(3);
    expect(b.describe().echoTotal).toBe(0);
  });
});
