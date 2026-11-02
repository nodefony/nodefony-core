/**
 * Séries numériques sur le fil (#618 D5/D6/D10) : octets petit-boutistes,
 * retard de boucle lu sur un percentile, charge de la sonde de débit.
 */
import { describe, expect, it } from "vitest";
import {
  toLittleEndianBytes,
  fromLittleEndianBytes,
  PLATFORM_LITTLE_ENDIAN,
} from "../realtime/typedArrayBytes";
import {
  THROUGHPUT_PAYLOAD_SIZES,
  isThroughputPayloadSize,
  createThroughputPayload,
} from "../realtime/throughputProbe";
import {
  eventLoopLagMs,
  EVENT_LOOP_RESOLUTION_MS,
} from "../service/cluster/processProbe";

describe("tableaux typés ↔ octets petit-boutistes", () => {
  it("écrit l'ordre petit-boutiste, quel que soit l'ordre de la machine", () => {
    const serie = new Float64Array([1.5, -2.25, Number.MAX_VALUE]);
    for (const machineLe of [true, false]) {
      // Sur une machine gros-boutiste, la mémoire est rangée à l'envers :
      // on la simule en retournant les octets AVANT de demander l'emballage.
      const memoire = new Uint8Array(serie.buffer.slice(0));
      if (!machineLe) {
        for (let i = 0; i < memoire.length; i += 8)
          memoire.subarray(i, i + 8).reverse();
      }
      const vue = new Float64Array(memoire.buffer);
      const octets = toLittleEndianBytes(vue, machineLe);
      const lecteur = new DataView(
        octets.buffer,
        octets.byteOffset,
        octets.byteLength,
      );
      expect(
        [0, 1, 2].map((i) => lecteur.getFloat64(i * 8, true)),
        `machine ${machineLe ? "petit" : "gros"}-boutiste`,
      ).toEqual([1.5, -2.25, Number.MAX_VALUE]);
    }
  });

  it("sur la machine courante, emballe SANS copie (vue sur la même mémoire)", () => {
    const serie = new Float32Array([1, 2, 3]);
    const octets = toLittleEndianBytes(serie);
    if (PLATFORM_LITTLE_ENDIAN) expect(octets.buffer).toBe(serie.buffer);
    expect(fromLittleEndianBytes(octets, Float32Array)).toEqual(serie);
  });

  it("relit des octets posés à une adresse non alignée (cas d'une trame décodée)", () => {
    const serie = new Float64Array([3.14, 2.71]);
    const trame = new Uint8Array(1 + serie.byteLength);
    trame.set(toLittleEndianBytes(serie), 1);
    const recus = trame.subarray(1); // byteOffset 1 : un Float64Array direct lèverait
    const relue = fromLittleEndianBytes(recus, Float64Array);
    expect(Array.from(relue)).toEqual([3.14, 2.71]);
  });

  it("relit des octets petit-boutistes sur une machine gros-boutiste", () => {
    const octets = toLittleEndianBytes(new Uint32Array([0x01020304]), true);
    const relue = fromLittleEndianBytes(octets, Uint32Array, false);
    // Machine gros-boutiste simulée : la valeur relue est rangée à l'envers en
    // mémoire, donc lue ICI (petit-boutiste) comme les octets retournés.
    expect(new DataView(relue.buffer).getUint32(0, false)).toBe(0x01020304);
  });

  it("refuse une longueur qui n'est pas un multiple d'un élément", () => {
    expect(() =>
      fromLittleEndianBytes(new Uint8Array(7), Float64Array),
    ).toThrow(RangeError);
  });
});

describe("retard de boucle lu sur un histogramme", () => {
  it("retranche la période d'échantillonnage : une boucle libre vaut 0, pas 20 ms", () => {
    expect(eventLoopLagMs(EVENT_LOOP_RESOLUTION_MS * 1e6)).toBe(0);
    expect(eventLoopLagMs((EVENT_LOOP_RESOLUTION_MS + 12.345) * 1e6)).toBe(
      12.35,
    );
    expect(eventLoopLagMs(0)).toBe(0);
  });
});

describe("charge de la sonde de débit", () => {
  it("n'admet que les trois tailles fermées", () => {
    for (const size of THROUGHPUT_PAYLOAD_SIZES)
      expect(isThroughputPayloadSize(size)).toBe(true);
    for (const v of [0, 1023, 2048, 1048577, "1024", null, undefined]) {
      expect(isThroughputPayloadSize(v), String(v)).toBe(false);
    }
  });

  it("rend exactement la taille demandée, les mêmes octets pour la même graine", () => {
    for (const size of [...THROUGHPUT_PAYLOAD_SIZES, 7]) {
      const a = createThroughputPayload(size);
      expect(a.byteLength).toBe(size);
      // Buffer.equals : un toEqual élément par élément coûte des secondes sur 1 Mo.
      expect(Buffer.from(createThroughputPayload(size)).equals(a)).toBe(true);
    }
    expect(
      Buffer.from(createThroughputPayload(1024, 1)).equals(
        createThroughputPayload(1024, 2),
      ),
    ).toBe(false);
  });

  it("n'est pas compressible (sinon la compression des trames fausserait la mesure)", async () => {
    const { deflateRawSync } = await import("node:zlib");
    const charge = createThroughputPayload(65536);
    expect(deflateRawSync(charge).byteLength).toBeGreaterThan(
      charge.byteLength * 0.98,
    );
  });
});
