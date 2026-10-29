import { describe, expect, it, vi } from "vitest";

/**
 * Règle perf/mémoire : rien d'alloué « au cas où ». Le codec ne réserve ses tampons
 * (arène d'encodage 32 Ko, cache de clés et estampilles du décodage) qu'au premier usage —
 * un process qui ne parle jamais CBOR ne paie rien. `arrayBuffers` compte précisément la
 * mémoire des `ArrayBuffer` du process.
 */
describe("CBOR / rien d'alloué au chargement", () => {
  it("importer le codec ne réserve aucun tampon ; le premier encodage et le premier décodage, si", async () => {
    vi.resetModules();
    const before = process.memoryUsage().arrayBuffers;
    const codec = await import("../realtime/codec/index");
    const afterImport = process.memoryUsage().arrayBuffers;
    expect(afterImport - before).toBeLessThan(8192);

    // L'instrument mord : le premier usage, lui, alloue l'arène (≥ 32 Ko) et les estampilles.
    codec.decodeCbor(codec.encodeCbor({ a: 1 }));
    const afterUse = process.memoryUsage().arrayBuffers;
    expect(afterUse - afterImport).toBeGreaterThanOrEqual(32768);
  });
});
