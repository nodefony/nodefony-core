/**
 * Probe de charge `BcryptEncoder` — chiffre le seul vrai coût CPU du module user
 * (le hachage), pour dimensionner la capacité d'authentification d'un process.
 *
 * Standalone (pas dans la suite vitest de non-régression) : `npm run test:load`.
 * `@node-rs/bcrypt` est natif (NAPI) et s'exécute sur le **threadpool libuv** →
 * le débit parallèle dépend de `UV_THREADPOOL_SIZE` (défaut 4). On mesure :
 *  - latence séquentielle (ms/hash) = temps de réponse d'un login isolé ;
 *  - débit parallèle (hash/s) = capacité sous concurrence (logins/s soutenables) ;
 *  - latence d'un verify (le cas chaud du login).
 */
import { BcryptEncoder } from "../../index";

const COST = Number(process.env.BCRYPT_COST ?? 12);
const N = Number(process.env.BCRYPT_N ?? 32);

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main(): Promise<void> {
  const enc = new BcryptEncoder(COST);
  const threads = process.env.UV_THREADPOOL_SIZE ?? "4 (défaut)";
  console.log(`BcryptEncoder cost=${COST}  N=${N}  UV_THREADPOOL_SIZE=${threads}`);

  // ── Latence séquentielle ──────────────────────────────────────────────────
  const lat: number[] = [];
  const seqStart = performance.now();
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    await enc.hash(`password-${i}`);
    lat.push(performance.now() - t);
  }
  const seqTotal = performance.now() - seqStart;
  lat.sort((a, b) => a - b);

  // hash de référence pour un verify cohérent (cas chaud du login).
  const knownHash = await enc.hash("known-secret");

  // ── Débit parallèle (sature le threadpool) ──────────────────────────────────
  const parStart = performance.now();
  await Promise.all(
    Array.from({ length: N }, (_, i) => enc.hash(`password-${i}`)),
  );
  const parTotal = performance.now() - parStart;

  // ── Verify (cas chaud du login) ─────────────────────────────────────────────
  const vStart = performance.now();
  const ok = await enc.verify("known-secret", knownHash);
  const vMs = performance.now() - vStart;

  console.log("\n── Latence séquentielle (1 hash à la fois) ──");
  console.log(`  avg   : ${(seqTotal / N).toFixed(1)} ms/hash`);
  console.log(`  p50   : ${pct(lat, 50).toFixed(1)} ms`);
  console.log(`  p99   : ${pct(lat, 99).toFixed(1)} ms`);
  console.log(`  débit : ${(1000 / (seqTotal / N)).toFixed(1)} hash/s (1 thread)`);

  console.log("\n── Débit parallèle (N concurrents → threadpool) ──");
  console.log(`  total : ${parTotal.toFixed(0)} ms pour ${N} hash`);
  console.log(`  débit : ${(N / (parTotal / 1000)).toFixed(1)} hash/s`);

  console.log("\n── Verify ──");
  console.log(`  ${vMs.toFixed(1)} ms (résultat=${ok})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
