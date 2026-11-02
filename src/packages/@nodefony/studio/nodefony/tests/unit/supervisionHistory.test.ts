/// <reference types="node" />
/**
 * Unit — historique de la supervision (#618 D4/D5/D10).
 *
 * Invariants verrouillés :
 *  - rien n'est échantillonné avant la première visite (lazy) ;
 *  - l'anneau rend ses points du plus ancien au plus récent, colonne par
 *    colonne, et oublie le plus ancien une fois plein ;
 *  - l'historique traverse les DEUX codecs du fil (CBOR, JSON `$bytes`) à
 *    l'identique — c'est ce qu'emprunteront le pont socket et le REST ;
 *  - le producteur admin publie la route sous la garde de la supervision.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fromLittleEndianBytes,
  JSON_BYTES_FRAME_CODEC,
  SUPERVISION_HISTORY_COLUMNS,
  SUPERVISION_LOOP_BANDS,
  type ISupervisionHistory,
  type SupervisionHistoryPoint,
} from "nodefony";
import { encodeCbor, decodeCbor } from "nodefony/cbor";
import {
  SupervisionRecorder,
  HISTORY_CAPACITY,
} from "../../realtime/supervisionHistory";
import { createStudioAdminApi } from "../../src/studioAdminApi";

/** Point dont chaque valeur dit sa colonne et son rang : `rang × 100 + colonne`. */
function point(rank: number): SupervisionHistoryPoint {
  const p = {} as Record<string, number>;
  SUPERVISION_HISTORY_COLUMNS.forEach((name, c) => {
    p[name] = rank * 100 + c;
  });
  SUPERVISION_LOOP_BANDS.forEach((name, c) => {
    p[name] = rank * 100 + 50 + c;
  });
  return p as SupervisionHistoryPoint;
}

/** Relit l'historique en colonnes nommées. */
function columns(h: ISupervisionHistory): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const values = fromLittleEndianBytes(h.values, Float64Array);
  const loop = fromLittleEndianBytes(h.loop, Float32Array);
  h.columns.forEach((name, c) => {
    out[name] = Array.from(values.subarray(c * h.length, (c + 1) * h.length));
  });
  h.loopColumns.forEach((name, c) => {
    out[name] = Array.from(loop.subarray(c * h.length, (c + 1) * h.length));
  });
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SupervisionRecorder — anneau colonnaire", () => {
  it("lazy : rien ne tourne ni n'est enregistré avant start()", () => {
    const r = new SupervisionRecorder(4, 1000);
    expect(r.running).toBe(false);
    r.sample(); // sans start : ne fait rien
    const h = r.snapshot();
    expect(h.length).toBe(0);
    expect(h.values.byteLength).toBe(0);
    expect(h.loop.byteLength).toBe(0);
  });

  it("rend les points du plus ancien au plus récent, colonne par colonne", () => {
    const r = new SupervisionRecorder(4, 1000);
    for (let i = 1; i <= 3; i += 1) r.record(point(i));
    const h = r.snapshot();
    expect(h.length).toBe(3);
    expect(h.values.byteLength).toBe(
      3 * SUPERVISION_HISTORY_COLUMNS.length * 8,
    );
    expect(h.loop.byteLength).toBe(3 * SUPERVISION_LOOP_BANDS.length * 4);
    const col = columns(h);
    expect(col.ts).toEqual([100, 200, 300]);
    expect(col.rss).toEqual([105, 205, 305]);
    expect(col.p50).toEqual([150, 250, 350]);
    expect(col.max).toEqual([153, 253, 353]);
  });

  it("une fois plein, oublie le plus ancien et garde l'ordre (retour en tête d'anneau)", () => {
    const r = new SupervisionRecorder(4, 1000);
    for (let i = 1; i <= 6; i += 1) r.record(point(i));
    const h = r.snapshot();
    expect(h.length).toBe(4);
    const col = columns(h);
    expect(col.ts).toEqual([300, 400, 500, 600]);
    expect(col.cpuPercent).toEqual([301, 401, 501, 601]);
    expect(col.p99).toEqual([352, 452, 552, 652]);
  });

  it("dimensions de production : 600 points × 6 séries = 28,8 Ko", () => {
    const r = new SupervisionRecorder();
    for (let i = 0; i < HISTORY_CAPACITY + 10; i += 1) r.record(point(i));
    expect(r.snapshot().values.byteLength).toBe(28_800);
  });
});

describe("SupervisionRecorder — échantillonnage du process", () => {
  it("un point par intervalle après start(), plus rien après stop() ; start() idempotent", () => {
    vi.useFakeTimers();
    const r = new SupervisionRecorder(10, 1000);
    r.start();
    r.start(); // un second minuteur doublerait les points
    expect(r.running).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(r.length).toBe(3);
    r.stop();
    expect(r.running).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(r.length).toBe(3);
    const col = columns(r.snapshot());
    expect(col.ts?.[1]).toBeGreaterThan(col.ts?.[0] ?? Infinity);
    for (const cpu of col.cpuPercent ?? []) {
      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(100);
    }
    for (const heap of col.heapUsed ?? []) expect(heap).toBeGreaterThan(0);
    for (const elu of col.eluUtilization ?? []) {
      expect(elu).toBeGreaterThanOrEqual(0);
      expect(elu).toBeLessThanOrEqual(1);
    }
  });
});

describe("historique sur le fil — les deux codecs", () => {
  const r = new SupervisionRecorder(8, 1000);
  for (let i = 1; i <= 11; i += 1) r.record(point(i));
  const h = r.snapshot();

  it("CBOR : les séries voyagent en chaînes d'octets et reviennent à l'identique", () => {
    const relu = decodeCbor(encodeCbor(h)) as ISupervisionHistory;
    expect(relu.values).toBeInstanceOf(Uint8Array);
    expect(columns(relu)).toEqual(columns(h));
  });

  it("JSON `$bytes` : mêmes séries une fois relues", () => {
    const texte = JSON_BYTES_FRAME_CODEC.encode(h);
    expect(typeof texte).toBe("string");
    const relu = JSON_BYTES_FRAME_CODEC.decode(texte) as ISupervisionHistory;
    expect(relu.loop).toBeInstanceOf(Uint8Array);
    expect(columns(relu)).toEqual(columns(h));
  });
});

describe("producteur admin de Studio", () => {
  it("publie supervision/history en GET, sous la garde de la supervision", async () => {
    const r = new SupervisionRecorder(4, 1000);
    r.record(point(1));
    let appels = 0;
    const api = createStudioAdminApi(() => {
      appels += 1;
      return r;
    });
    expect(api.adminNamespace).toBe("studio");
    const [ep, ...reste] = api.adminEndpoints();
    expect(reste).toHaveLength(0);
    expect(ep?.path).toBe("supervision/history");
    expect(ep?.method).toBe("GET");
    expect(ep?.role).toBe("ROLE_SUPERVISOR");
    expect(appels, "l'enregistreur ne démarre qu'à la première visite").toBe(0);
    const body = (await ep?.handler({
      params: {},
      query: {},
      body: null,
      user: null,
      roles: [],
    })) as ISupervisionHistory;
    expect(appels).toBe(1);
    expect(body.length).toBe(1);
    expect(columns(body).ts).toEqual([100]);
  });
});
