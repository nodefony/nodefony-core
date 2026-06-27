import type { IAuditEvent } from "../../contracts/IAuditEvent";
import type { IWebhookEndpoint } from "../../contracts/IWebhookEndpoint";
import type { IWebhookDeliveryPolicy } from "../../service/webhooks";
import { webhookSignatureHeaders } from "./webhookSignature";
import type { IDeliveryResult } from "./webhookDelivery";

/**
 * Dispatcher de webhooks sortants — abonné au journal d'audit, il filtre les
 * événements par souscription, signe (Standard Webhooks v1) et livre, **sans
 * jamais mettre le framework en danger** (RÈGLE PERF) :
 *
 * - **Hot-path protégé** : `onAuditEvent` (appelé dans le fire-and-forget de
 *   `AuditService.record`) court-circuite à **coût nul** quand aucun endpoint
 *   n'est configuré (cas dominant). Sinon il empile seulement ; le travail
 *   (JSON/signature/réseau) est **différé** hors de la pile via un pump microtask.
 * - **Concurrence bornée** : au plus `maxConcurrent` livraisons en vol → un
 *   endpoint lent/mort ne peut pas saturer sockets/FD/mémoire.
 * - **File bornée** : au-delà de `maxQueue`, les livraisons sont **abandonnées**
 *   (best-effort) — jamais de croissance mémoire illimitée sous un pic.
 * - **Lazy alloc** : ni file ni Set de timers tant qu'aucune livraison.
 *
 * Toutes les E/S et le temps sont **injectés** (`deps`) → logique testable sans
 * réseau ni timers réels.
 */

const MAX_BACKOFF_MS = 300_000; // 5 min
const BASE_BACKOFF_MS = 5_000;

/** Une souscription matche-t-elle une action d'audit ? `*` = toutes, `x.*` = préfixe. */
export function matchesSubscription(
  patterns: readonly string[],
  action: string,
): boolean {
  for (const p of patterns) {
    if (p === "*" || p === action) return true;
    if (p.endsWith(".*") && action.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Classe le résultat d'une livraison : 2xx = succès ; réseau/timeout/429/408/5xx =
 * réessayable ; 3xx/4xx (config cliente erronée) = échec définitif (pas de retry).
 */
export function classifyDelivery(
  r: IDeliveryResult,
): "success" | "retry" | "fail" {
  if (r.ok) return "success";
  if (r.status === null) return "retry"; // réseau / timeout
  if (r.status === 429 || r.status === 408 || r.status >= 500) return "retry";
  return "fail"; // 3xx (non suivi) / 4xx → ne pas réessayer
}

/** Backoff exponentiel déterministe (jitter cross-pod = slice Redis cluster). */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

/** Trace d'une livraison terminée, poussée à `recordDelivery` (historique). */
export interface IWebhookDeliveryRecord {
  readonly messageId: string;
  readonly type: string;
  readonly attempt: number;
  readonly ok: boolean;
  readonly status: number | null;
  readonly error: string | null;
  readonly durationMs: number;
  readonly requestBody: string;
  readonly responseBody: string | null;
}

/** Dépendances injectées du dispatcher (E/S + temps + politique). */
export interface IWebhookDispatcherDeps {
  /** Nombre d'endpoints (0-alloc) — court-circuit hot-path. */
  endpointCount(): number;
  /** Snapshot des endpoints (n'est lu que si `endpointCount() > 0`). */
  getSnapshot(): IWebhookEndpoint[];
  /** Secret de signature en clair (`whsec_…`) d'un endpoint. */
  secretOf(endpoint: IWebhookEndpoint): string;
  /** Politique de livraison (tolérance/retries/timeout/concurrence/file). */
  readonly policy: IWebhookDeliveryPolicy;
  /** Re-contrôle SSRF + renvoie les IP à pinner ; **lève** si la cible est interdite. */
  resolveTarget(url: string): Promise<string[]>;
  /** Émet la requête HTTP signée (injecté → testable). */
  deliver(
    url: string,
    body: string,
    headers: Record<string, string>,
    opts: { timeoutMs: number; addresses: string[]; allowHttp: boolean },
  ): Promise<IDeliveryResult>;
  /** Met à jour l'endpoint (lastDelivery, failureCount, auto-disable). */
  markDelivery(id: string, result: IDeliveryResult): void | Promise<void>;
  /** Enregistre une trace de livraison (historique « récentes », par endpoint). */
  recordDelivery(id: string, rec: IWebhookDeliveryRecord): void;
  /** Horloge injectable. */
  now(): number;
  /** Génère un `webhook-id` de message. */
  newMessageId(): string;
  /** Planifie un retry ; retourne une fonction d'annulation. */
  schedule(fn: () => void, ms: number): () => void;
  /** Journalisation (saturation / erreurs inattendues). */
  log(message: string): void;
}

interface Job {
  readonly ep: IWebhookEndpoint;
  readonly event: IAuditEvent;
  readonly attempt: number;
}

export class WebhookDispatcher {
  readonly #deps: IWebhookDispatcherDeps;
  /** File des livraisons en attente (lazy, bornée à `policy.maxQueue`). */
  #queue: Job[] | null = null;
  /** Livraisons en vol (≤ `policy.maxConcurrent`). */
  #inFlight = 0;
  /** Annulations des retries planifiés (lazy) — vidées au shutdown. */
  #timers: Set<() => void> | null = null;
  /** Livraisons abandonnées (file pleine) — observabilité. */
  #dropped = 0;
  #pumpScheduled = false;
  #stopped = false;

  constructor(deps: IWebhookDispatcherDeps) {
    this.#deps = deps;
  }

  /**
   * Réagit à un événement d'audit. **Hot-path** : court-circuit à coût nul si
   * aucun endpoint ; sinon filtre et empile (le travail lourd est différé).
   */
  onAuditEvent(event: IAuditEvent): void {
    if (this.#stopped) return;
    // Anti-boucle : nos propres événements (`webhook.*`) ne redéclenchent JAMAIS
    // de livraison (sinon amplification : failed → webhook → failed → …).
    if (event.category === "webhook") return;
    if (this.#deps.endpointCount() === 0) return; // 0 alloc, 0 travail
    for (const ep of this.#deps.getSnapshot()) {
      if (!ep.enabled) continue;
      if (!matchesSubscription(ep.events, event.action)) continue;
      this.#enqueue({ ep, event, attempt: 0 });
    }
  }

  /** Empile une livraison ; **abandonne** (best-effort) si la file est pleine. */
  #enqueue(job: Job): void {
    if (this.#stopped) return;
    if (this.#queue === null) this.#queue = [];
    if (this.#queue.length >= this.#deps.policy.maxQueue) {
      this.#dropped++;
      if (this.#dropped === 1 || this.#dropped % 100 === 0) {
        this.#deps.log(
          `webhooks: file pleine (${this.#deps.policy.maxQueue}) — ${this.#dropped} livraison(s) abandonnée(s) (best-effort)`,
        );
      }
      return;
    }
    this.#queue.push(job);
    this.#schedulePump();
  }

  /** Déclenche le pump hors de la pile courante (1 microtask coalescée). */
  #schedulePump(): void {
    if (this.#pumpScheduled || this.#stopped) return;
    this.#pumpScheduled = true;
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }

  /** Lance des livraisons jusqu'à `maxConcurrent`. */
  #pump(): void {
    if (this.#queue === null || this.#stopped) return;
    const max = this.#deps.policy.maxConcurrent;
    while (this.#inFlight < max && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      this.#inFlight++;
      void this.#process(job).finally(() => {
        this.#inFlight--;
        if (this.#queue !== null && this.#queue.length > 0) {
          this.#schedulePump();
        }
      });
    }
  }

  /** Signe + livre une tentative ; gère succès / retry / échec définitif. */
  async #process(job: Job): Promise<void> {
    const { ep, event, attempt } = job;
    try {
      const id = this.#deps.newMessageId();
      const nowMs = this.#deps.now();
      const tsS = Math.floor(nowMs / 1000);
      const body = JSON.stringify({
        id,
        timestamp: new Date(nowMs).toISOString(),
        type: event.action,
        data: event,
      });
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": "Nodefony-Webhooks/1.0",
        ...webhookSignatureHeaders(this.#deps.secretOf(ep), id, tsS, body),
      };

      let addresses: string[];
      try {
        addresses = await this.#deps.resolveTarget(ep.url); // re-SSRF + pin
      } catch (e) {
        // URL devenue interne (rebinding) ou injoignable → abandon, pas de retry.
        const error = `ssrf: ${(e as Error).message}`;
        await this.#deps.markDelivery(ep.id, {
          ok: false,
          status: null,
          error,
        });
        this.#deps.recordDelivery(ep.id, {
          messageId: id,
          type: event.action,
          attempt,
          ok: false,
          status: null,
          error,
          durationMs: this.#deps.now() - nowMs,
          requestBody: body,
          responseBody: null,
        });
        return;
      }

      const result = await this.#deps.deliver(ep.url, body, headers, {
        timeoutMs: this.#deps.policy.deliveryTimeoutMs,
        addresses,
        allowHttp: this.#deps.policy.allowHttp,
      });

      if (
        classifyDelivery(result) === "retry" &&
        attempt < this.#deps.policy.maxRetries
      ) {
        this.#scheduleRetry(job);
        return;
      }
      await this.#deps.markDelivery(ep.id, result); // succès OU échec définitif
      // Trace l'issue FINALE (pas les retries intermédiaires) → historique récent.
      this.#deps.recordDelivery(ep.id, {
        messageId: id,
        type: event.action,
        attempt,
        ok: result.ok,
        status: result.status,
        error: result.error,
        durationMs: this.#deps.now() - nowMs,
        requestBody: body,
        responseBody: result.responseBody ?? null,
      });
    } catch (e) {
      this.#deps.log(`webhook dispatch ${ep.id}: ${(e as Error).message}`);
    }
  }

  /** Replanifie la livraison après backoff (repasse par la file bornée). */
  #scheduleRetry(job: Job): void {
    if (this.#stopped) return;
    if (this.#timers === null) this.#timers = new Set();
    const cancel = this.#deps.schedule(() => {
      this.#timers?.delete(cancel);
      this.#enqueue({ ep: job.ep, event: job.event, attempt: job.attempt + 1 });
    }, backoffMs(job.attempt));
    this.#timers.add(cancel);
  }

  /** Livraisons abandonnées pour cause de file pleine (observabilité). */
  droppedCount(): number {
    return this.#dropped;
  }

  /** Arrêt propre : stoppe l'admission, annule les retries, vide la file. */
  shutdown(): void {
    this.#stopped = true;
    if (this.#timers !== null) {
      for (const cancel of this.#timers) cancel();
      this.#timers.clear();
      this.#timers = null;
    }
    this.#queue = null;
  }
}
