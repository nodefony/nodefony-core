/**
 * W3C Trace Context — parse + generate `traceparent` headers (P2.7).
 *
 * Spec: https://www.w3.org/TR/trace-context/
 * Format: `<version>-<traceId>-<parentId>-<flags>`
 *   - version: 2 hex chars (currently always `00`; `ff` is reserved/invalid)
 *   - traceId: 32 hex chars (16 bytes), non-zero
 *   - parentId / spanId: 16 hex chars (8 bytes), non-zero
 *   - flags: 2 hex chars (`01` = sampled)
 *
 * Behaviour at the request boundary:
 *   - Valid incoming traceparent → keep `version`/`traceId`/`flags`, generate
 *     a fresh `parentId` (we are a child span in the existing trace).
 *   - Missing or invalid → mint a brand-new traceparent (version `00`,
 *     `flags=01` sampled by default).
 *
 * The result is propagated through {@link RequestContext} and echoed on the
 * HTTP response so downstream services and clients can stitch the trace.
 */

import { randomFillSync } from "node:crypto";

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentId: string;
  flags: string;
}

/**
 * Parse a `traceparent` header value. Returns `null` when the header is
 * missing, malformed, or carries an all-zero traceId/spanId (per W3C the
 * recipient MUST NOT propagate such values).
 */
export function parseTraceparent(
  header: string | undefined | null,
): ParsedTraceparent | null {
  if (typeof header !== "string") return null;
  const m = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!m) return null;
  const [, version, traceId, parentId, flags] = m;
  if (version === "ff") return null;
  if (/^0+$/.test(traceId)) return null;
  if (/^0+$/.test(parentId)) return null;
  return { version, traceId, parentId, flags };
}

// Perf (L2) — `randomBytes` ne met PAS en cache l'entropie : chaque appel = 1
// syscall `getentropy`. `resolveTraceparent` est sur le hot path (1×/requête
// HTTP, vu au profil 2026-05-30). On amortit en remplissant un pool via
// `randomFillSync` (CSPRNG, MÊME qualité), découpé en spans, refill quand épuisé
// — exactement le principe du cache d'entropie de `crypto.randomUUID` (128 UUIDs).
// Les ids W3C sont des corrélateurs, pas des secrets ; on garde le CSPRNG, on ne
// fait qu'amortir l'appel système (~170 spans / refill au lieu de 1 syscall/req).
// Node est mono-thread (event loop) → pas de course sur l'offset.
const ENTROPY_POOL_BYTES = 4096;
const entropyPool = Buffer.allocUnsafe(ENTROPY_POOL_BYTES);
// Initialisé à « épuisé » → le 1er `randomHex` force un `randomFillSync` AVANT
// toute lecture : jamais d'octets non initialisés d'`allocUnsafe` servis.
let entropyOffset = ENTROPY_POOL_BYTES;

/** `size` octets aléatoires en hex, puisés dans le pool amorti (refill si épuisé). */
function randomHex(size: number): string {
  if (entropyOffset + size > ENTROPY_POOL_BYTES) {
    randomFillSync(entropyPool);
    entropyOffset = 0;
  }
  const hex = entropyPool.toString("hex", entropyOffset, entropyOffset + size);
  entropyOffset += size;
  return hex;
}

/**
 * Resolve the traceparent to attach to a new request. Honors an incoming
 * valid header, generates a fresh one otherwise.
 *
 * @param header - raw value read from `request.headers.traceparent`
 * @returns the traceparent string to propagate (always well-formed)
 */
export function resolveTraceparent(header: string | undefined | null): string {
  const parsed = parseTraceparent(header);
  if (parsed) {
    const newSpanId = randomHex(8);
    return `${parsed.version}-${parsed.traceId}-${newSpanId}-${parsed.flags}`;
  }
  const traceId = randomHex(16);
  const parentId = randomHex(8);
  return `00-${traceId}-${parentId}-01`;
}
