import type { IAuditEvent } from "../../contracts/IAuditEvent";
import { PLATFORM_CHANNELS } from "nodefony";

/**
 * Canal WS du flux live d'audit (P6.14 lot 4). Le préfixe `security:` le place
 * sous le plancher `SECURITY_CHANNEL_POLICY` (ROLE_NODEFONY_ADMIN) du verrou de
 * frame — un user lambda ne peut pas s'y abonner (refus audité `frame.denied`).
 */
export const SECURITY_AUDIT_CHANNEL = PLATFORM_CHANNELS.audit;

/** Source d'événements live — sous-ensemble de `IAuditSink` (slot `subscribe`). */
export interface IAuditEventSource {
  subscribe(listener: (event: IAuditEvent) => void): () => void;
}

/** Charge poussée sur le canal `nodefony:audit` — batch coalescé + omis. */
export interface IAuditBatch {
  events: IAuditEvent[];
  dropped: number;
}

/** Options de coalescing du pont d'audit. */
export interface AuditBridgeOptions {
  /** Fenêtre d'agrégation : 1 frame WS au plus toutes les `flushMs`. Défaut 250. */
  flushMs?: number;
  /** Cap d'un batch (ring buffer) : au-delà, on garde les + récents et on compte
   *  les omis. Borne la mémoire ET le nb d'événements envoyés au front. Défaut 200. */
  maxBatch?: number;
}

/**
 * Pont journal d'audit → canal `nodefony:audit`, **coalescé** (P6.14 lot 4).
 *
 * Calque {@link createSyslogBridge} (studio) : au lieu de 1 frame WS par
 * événement (un pic d'`auth.failure` sous brute-force noierait la console
 * auditeur), on accumule dans un **ring buffer borné** et on flush **1 frame
 * agrégée toutes les `flushMs`** : `{ events, dropped }`. Sous surcharge, le ring
 * écrase les plus vieux et `dropped` indique combien ont été omis → la console
 * affiche un récap au lieu de se figer (budget borné, dégradable — règle
 * observabilité « superviser ≠ tomber la prod »).
 *
 * **Lazy par construction** (créé par le hub au 1ᵉʳ abonné, `dispose` au dernier) :
 * tant qu'aucun auditeur n'écoute `nodefony:audit`, ce pont N'EXISTE PAS — aucun
 * listener sur l'`AuditService`, aucun timer. Au repos avec auditeur connecté mais
 * sans événement : ring `null`, 0 timer (armé au 1ᵉʳ événement, `unref`).
 *
 * @param source  - l'`AuditService` (slot `subscribe`).
 * @param publish - publication hub (le canal est fourni par la factory).
 * @param channel - canal de publication (`nodefony:audit`).
 * @returns dispose() — détache le listener `AuditService` ET désarme le timer.
 *          OBLIGATOIRE (aucun listener/timer sans cleanup, sinon fuite à chaque
 *          dernier désabonnement).
 */
export function createAuditBridge(
  source: IAuditEventSource,
  publish: (channel: string, payload: unknown) => void,
  channel: string,
  opts: AuditBridgeOptions = {},
): () => void {
  const flushMs = opts.flushMs ?? 250;
  const maxBatch = opts.maxBatch ?? 200;

  let ring: IAuditEvent[] | null = null; // lazy : alloué au 1ᵉʳ événement
  let head = 0; // index du plus ancien
  let count = 0; // éléments vivants
  let dropped = 0; // omis (cap dépassé) depuis le dernier flush
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (count === 0 && dropped === 0) return;
    const events = new Array<IAuditEvent>(count);
    for (let i = 0; i < count; i++) events[i] = ring![(head + i) % maxBatch]!;
    const d = dropped;
    // reset + libère les refs (évite de retenir des événements).
    for (let i = 0; i < maxBatch; i++) ring![i] = undefined as never;
    head = 0;
    count = 0;
    dropped = 0;
    publish(channel, { events, dropped: d } satisfies IAuditBatch);
  };

  const onEvent = (event: IAuditEvent): void => {
    if (ring === null) ring = new Array<IAuditEvent>(maxBatch);
    if (count === maxBatch) {
      ring[head] = event; // ring plein → écrase le plus ancien
      head = (head + 1) % maxBatch;
      dropped++;
    } else {
      ring[(head + count) % maxBatch] = event;
      count++;
    }
    if (timer === null) {
      timer = setTimeout(flush, flushMs);
      (timer as { unref?: () => void }).unref?.();
    }
  };

  const unsubscribe = source.subscribe(onEvent);
  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    ring = null;
    head = count = dropped = 0;
    unsubscribe();
  };
}

export default createAuditBridge;
