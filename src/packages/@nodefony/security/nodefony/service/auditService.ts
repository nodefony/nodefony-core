import { Service, Module, Container, Event } from "nodefony";
import { randomBytes } from "node:crypto";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineSecurityConfig";
import { MemoryAuditStore } from "../src/audit/MemoryAuditStore";
import type { IAuditEvent, IAuditEventDraft } from "../contracts/IAuditEvent";
import type {
  IAuditQuery,
  IAuditQueryResult,
  IAuditSink,
  IAuditStore,
} from "../contracts/IAuditStore";

const serviceName = "auditService";
const MS_PER_DAY = 86_400_000;
const GC_INTERVAL_MS = 3_600_000; // 1 h

/**
 * Journal d'audit de sécurité (P6.14) — collecte les **événements** de sécurité
 * (login, refus d'accès, jeton émis/révoqué, défense CSRF/CORS, verrou WS) émis
 * EXPLICITEMENT par le firewall, les authenticators et les controllers. Distinct
 * du log de trafic (`JsonAuditLogger`, P3.1, 1 PDU/requête) : ici on trace les
 * **transitions d'état** de sécurité, jamais le hot-path par requête.
 *
 * Propriétaire du {@link IAuditStore} (référence mémoire append-only) : le pose au
 * container (`auditStore`, consommé par le data plane P6.15) et arme le `gc` de
 * rétention (timer `unref`). Implémente {@link IAuditSink} — `record` est
 * **fire-and-forget** (jamais bloquant) et **no-op à coût nul** si désactivé.
 *
 * Slot : store **pluggable** (ORM/Loki, multi-pod) = lot futur, comme
 * `tokenStoreRegistry`. Le socle n'embarque que la référence mémoire.
 */
class AuditService extends Service implements IAuditSink {
  #store: IAuditStore | null = null;
  #enabled = false;
  /** Abonnés au flux live — `null` tant qu'aucun (lazy, règle hooks). */
  #listeners: Array<(event: IAuditEvent) => void> | null = null;
  /** Préfixe d'id unique au process (1 seul `randomBytes` au boot) + compteur. */
  #idPrefix = "";
  #seq = 0;
  #gcTimer: NodeJS.Timeout | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
    this.kernel?.once("onTerminate", () => this.#shutdown());
  }

  // ── Cycle de vie ─────────────────────────────────────────────────────────────

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface
      // (l'audit restera inactif — `record` no-op).
      return;
    }
    if (!config.audit.enabled) {
      this.log("audit service idle — désactivé par la config", "DEBUG");
      return;
    }
    this.#enabled = true;
    this.#idPrefix = randomBytes(4).toString("hex");
    this.#store = new MemoryAuditStore(
      Date.now,
      config.audit.retentionDays * MS_PER_DAY,
    );
    // Partage par NOM (data plane P6.15, bridge WS Lot 4) — convention-frère
    // `tokenStore`/`passwordEncoder`.
    this.container?.set("auditStore", this.#store);
    this.#gcTimer = setInterval(() => {
      void this.#store?.gc().then((purged) => {
        if (purged > 0) {
          this.log(`audit gc — ${purged} événement(s) purgé(s)`, "DEBUG");
        }
      });
    }, GC_INTERVAL_MS);
    this.#gcTimer.unref?.();
    this.log(
      `audit service ready — store "memory", rétention ${config.audit.retentionDays}j`,
      "DEBUG",
    );
  }

  #shutdown(): void {
    if (this.#gcTimer) {
      clearInterval(this.#gcTimer);
      this.#gcTimer = null;
    }
    this.#listeners = null;
    this.#store = null;
    this.#enabled = false;
  }

  // ── IAuditSink ───────────────────────────────────────────────────────────────

  record(draft: IAuditEventDraft): void {
    // Coût NUL si désactivé : aucune allocation, aucun appel système d'horloge.
    if (!this.#enabled || this.#store === null) {
      return;
    }
    const event: IAuditEvent = {
      ...draft,
      id: `${this.#idPrefix}-${(this.#seq++).toString(36)}`,
      ts: Date.now(),
    };
    // Persistance best-effort : l'audit ne bloque ni ne fait échouer le flux
    // métier (store en panne → log ERROR, pas un login KO).
    this.#store.append(event).catch((error) => this.log(error, "ERROR"));
    // Notifie le live (bridge WS) seulement s'il y a des abonnés.
    if (this.#listeners !== null) {
      for (let i = 0; i < this.#listeners.length; i++) {
        try {
          this.#listeners[i]!(event);
        } catch (error) {
          this.log(error, "ERROR");
        }
      }
    }
  }

  subscribe(listener: (event: IAuditEvent) => void): () => void {
    if (this.#listeners === null) {
      this.#listeners = [];
    }
    this.#listeners.push(listener);
    let active = true;
    return () => {
      if (!active || this.#listeners === null) {
        return;
      }
      active = false;
      const idx = this.#listeners.indexOf(listener);
      if (idx >= 0) {
        this.#listeners.splice(idx, 1);
      }
      if (this.#listeners.length === 0) {
        this.#listeners = null; // re-null (règle hooks : pas de structure vide qui traîne)
      }
    };
  }

  // ── Lecture (data plane P6.15) ───────────────────────────────────────────────

  /** Lit une page du journal (délègue au store) ; vide si l'audit est inactif. */
  query(filter?: IAuditQuery): Promise<IAuditQueryResult> {
    if (this.#store === null) {
      return Promise.resolve({ events: [], nextBefore: null, total: 0 });
    }
    return this.#store.query(filter);
  }

  /** `true` si l'audit est actif (config `audit.enabled`). */
  isEnabled(): boolean {
    return this.#enabled;
  }
}

export default AuditService;
