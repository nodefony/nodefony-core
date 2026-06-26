import { GcScheduler, type IIdempotencyStore } from "nodefony";

/**
 * Options d'armement du balayage périodique d'un store d'idempotence.
 */
export interface IIdempotencyGcOptions {
  /** Intervalle entre deux purges (s). 0 = désarmé (cron / TTL natif). */
  intervalS: number;
  /** Étale le départ (anti thundering-herd cluster sur le store SQL partagé). */
  jitter: boolean;
  /** Reçoit l'erreur d'une passe de gc qui a levé. */
  onError: (error: unknown) => void;
  /** Journalise l'armement (observabilité boot / preuve e2e). */
  log?: (message: string) => void;
}

/**
 * Arme un {@link GcScheduler} qui purge périodiquement les entrées expirées d'un
 * store d'idempotence — **UNIQUEMENT si le store expose `gc()`**.
 *
 * Pourquoi ce gating : un store à **expiration native** (`redis` → `SET … PX`) ou à
 * **purge passive** (`memory` → éviction FIFO au cap) **n'expose pas** `gc()` ; les
 * brancher sur un timer serait un no-op coûteux. Seul un store **SQL** (`drizzle`,
 * `DELETE WHERE expiresAt <= now`) en a besoin — et son `gc()` était jusqu'ici
 * **orphelin** (jamais appelé → fuite : les clés mortes s'accumulaient en base).
 * Ce helper ferme ce trou, et l'isole de `onKernelBoot` pour être **testable sans
 * booter un kernel**.
 *
 * @returns le scheduler armé (à `stop()` au shutdown), ou `null` si le store n'a
 *   pas de `gc()` (rien à planifier).
 */
export function scheduleIdempotencyGc(
  store: IIdempotencyStore,
  opts: IIdempotencyGcOptions,
): GcScheduler | null {
  // Store à TTL natif (redis) ou purge passive (memory) → rien à planifier.
  if (typeof store.gc !== "function") return null;
  const runGc = store.gc.bind(store); // préserve `this` = le store
  const scheduler = new GcScheduler({
    intervalS: opts.intervalS,
    jitter: opts.jitter,
    run: () => runGc(),
    onError: opts.onError,
  });
  const armed = scheduler.start();
  opts.log?.(
    armed
      ? `idempotency gc armed — purge every ${opts.intervalS}s (SQL store exposes gc())`
      : `idempotency gc disarmed — intervalS=${opts.intervalS} (delegated to cron / external)`,
  );
  return scheduler;
}
