import {
  Service,
  Module,
  Container,
  Event,
  AUTO_STORE,
  EMPTY_INFRA,
  resolveAutoStore,
  deriveStoreBackend,
  readStoreLocation,
} from "nodefony";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import type { IWebhookStore } from "../contracts/IWebhookStore";
import type {
  IWebhookEndpoint,
  IWebhookDelivery,
  WebhookEndpointSummary,
  WebhookEndpointUpdate,
} from "../contracts/IWebhookEndpoint";
import {
  getWebhookStoreFactory,
  listWebhookStores,
} from "../src/webhook/webhookStoreRegistry";
import {
  decryptSecret,
  deriveWebhookKey,
  encryptSecret,
  generateEphemeralKey,
} from "../src/webhook/webhookCipher";
import { assertPublicUrl } from "../src/net/ssrfGuard";
import {
  WebhookDispatcher,
  type IWebhookDeliveryRecord,
} from "../src/webhook/WebhookDispatcher";
import {
  deliverWebhook,
  type IDeliveryResult,
} from "../src/webhook/webhookDelivery";
import type { IAuditEvent, IAuditEventDraft } from "../contracts/IAuditEvent";

const serviceName = "webhooks";

/** Historique de livraisons gardé PAR endpoint (ring borné, RAM, par pod). */
const MAX_DELIVERIES_PER_ENDPOINT = 20;
/** Corps de requête tronqué dans l'historique (anti-mémoire). */
const MAX_RECORDED_BODY = 8192;

/** Entrée de création d'un endpoint (les champs système sont dérivés). */
export interface IWebhookRegisterInput {
  /** URL de destination (validée anti-SSRF). */
  readonly url: string;
  /** Actions d'audit souscrites (`"*"` = toutes). */
  readonly events: readonly string[];
  /** Libellé humain optionnel. */
  readonly description?: string | null;
  /** Actif dès la création ? Défaut : `true`. */
  readonly enabled?: boolean;
  /** Identité de l'admin créateur (traçabilité). */
  readonly createdBy?: string | null;
  /** Slot multi-tenant (réservé). */
  readonly tenantId?: string | null;
  /** Métadonnées extensibles. */
  readonly metadata?: Record<string, unknown>;
}

/** Résultat de création/rotation : le secret en clair n'est exposé qu'ici, **une fois**. */
export interface IWebhookSecretReveal {
  /** Endpoint (sans secret chiffré). */
  readonly endpoint: WebhookEndpointSummary;
  /** Secret de signature en clair (`whsec_…`) — à communiquer au consommateur. */
  readonly secret: string;
}

/** Politique de livraison lue par le dispatcher (Slice B). */
export interface IWebhookDeliveryPolicy {
  readonly timestampToleranceS: number;
  readonly maxRetries: number;
  readonly autoDisableThreshold: number;
  readonly deliveryTimeoutMs: number;
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly allowHttp: boolean;
  readonly denyPrivateIps: boolean;
}

/** Retire le secret chiffré → vue publique. */
function toSummary(endpoint: IWebhookEndpoint): WebhookEndpointSummary {
  const { secretEnc: _omit, ...rest } = endpoint;
  return rest;
}

/** Identifiant public d'endpoint (`wh_<random url-safe>`). */
function generateId(): string {
  return `wh_${randomBytes(12).toString("base64url")}`;
}

/** Secret de signature Standard Webhooks (`whsec_<base64 256 bits>`). */
function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

/**
 * **Webhooks sortants** (P6.13) — service d'orchestration du registre d'endpoints.
 *
 * Coquille fine : au boot (si `webhooks.enabled`) il résout le **store**
 * d'endpoints pluggable + la **clé de chiffrement** des secrets de signature, puis
 * expose le CRUD (register/list/update/rotate/revoke). Le secret de signature est
 * **chiffré au repos** (réversible : relu pour signer chaque livraison, jamais
 * haché). La livraison signée elle-même (Standard Webhooks v1) vit dans le
 * dispatcher (Slice B), qui consomme {@link getSnapshot}/{@link getSigningKey}.
 *
 * Toute URL est validée **anti-SSRF** à l'enregistrement (et re-pinnée à la
 * livraison). Politique de clé calquée sur TOTP/RedisIdempotencyStore : absente en
 * dev = clé éphémère + WARNING ; en production = fatal (webhooks désactivés).
 */
class WebhookService extends Service {
  #config: ISecurityConfig | null = null;
  #store: IWebhookStore | null = null;
  #key: Buffer | null = null;
  #ready = false;
  /** Cache mémoire des endpoints (snapshot sync pour le dispatcher). */
  #endpoints: Map<string, IWebhookEndpoint> | null = null;
  /** Dispatcher de livraison (abonné à l'audit) — créé au boot si l'audit existe. */
  #dispatcher: WebhookDispatcher | null = null;
  /** Désabonnement de l'audit (appelé à l'arrêt). */
  #unsubscribe: (() => void) | null = null;
  /** Sink d'audit — trace l'auto-désactivation (signal borné, pas chaque échec). */
  #audit: { record(draft: IAuditEventDraft): void } | null = null;
  /** Historique de livraisons par endpoint (lazy, ring borné, RAM par pod). */
  #deliveries: Map<string, IWebhookDelivery[]> | null = null;

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
      // Config invalide : le firewall logge déjà CRITIC + fail-closed.
      return;
    }
    if (!config.webhooks.enabled) {
      this.log("webhooks idle — désactivés en config", "DEBUG");
      return;
    }
    const store = this.#resolveStore(config);
    if (!store) return;
    const key = this.#resolveKey(config);
    if (!key) return;
    this.#config = config;
    this.#store = store;
    this.#key = key;
    this.#ready = true;
    void this.#reloadSnapshot();
    this.#attachDispatcher();
    this.log(`webhooks ready — store "${config.webhooks.store}"`, "DEBUG");
  }

  /**
   * Branche le dispatcher de livraison sur le journal d'audit (abonné). No-op si
   * l'audit est absent (CRUD seul). Le listener ne fait que filtrer + différer
   * (jamais de travail bloquant dans le hot-path de `record()`).
   */
  #attachDispatcher(): void {
    const audit = this.get<{
      subscribe(l: (e: IAuditEvent) => void): () => void;
      record(draft: IAuditEventDraft): void;
    }>("auditService");
    if (!audit || typeof audit.subscribe !== "function") {
      this.log("webhooks: auditService absent — dispatcher inactif", "WARNING");
      return;
    }
    this.#audit = audit;
    this.#dispatcher = new WebhookDispatcher({
      endpointCount: () => this.endpointCount(),
      getSnapshot: () => this.getSnapshot(),
      secretOf: (ep) => this.decryptEndpointSecret(ep).toString("utf8"),
      policy: this.getDeliveryPolicy(),
      resolveTarget: (url) => this.#resolveTarget(url),
      deliver: (url, body, headers, opts) =>
        deliverWebhook(url, body, headers, opts),
      markDelivery: (id, r) => this.markDelivery(id, r),
      recordDelivery: (id, rec) => this.#recordDelivery(id, rec),
      now: () => Date.now(),
      newMessageId: () => `msg_${randomBytes(12).toString("base64url")}`,
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        (t as { unref?: () => void }).unref?.();
        return () => clearTimeout(t);
      },
      log: (m) => this.log(m, "ERROR"),
    });
    this.#unsubscribe = audit.subscribe((e) =>
      this.#dispatcher!.onAuditEvent(e),
    );
    this.log("webhooks dispatcher abonné à l'audit", "DEBUG");
  }

  /** Arrêt propre : désabonnement audit + annulation des retries en vol. */
  #shutdown(): void {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    this.#dispatcher?.shutdown();
    this.#dispatcher = null;
  }

  /** Adapter posé au container (ORM) prioritaire, sinon driver configuré (registre). */
  #resolveStore(config: ISecurityConfig): IWebhookStore | null {
    const existing = this.get<IWebhookStore>("webhookStore");
    if (existing) {
      this.kernel?.registerStoreResolution({
        brick: "webhooks",
        nature: "durable",
        configured: config.webhooks.store,
        resolved: deriveStoreBackend(existing),
        available: listWebhookStores(),
        reason: "adapter posé au container (infra database déclarée)",
        configPath: "security.webhooks.store",
        location: readStoreLocation(existing),
      });
      return existing;
    }
    // `auto` (défaut) = suivre l'infra database déclarée, borné aux backends
    // enregistrés ; repli memory ANNONCÉ. Valeur explicite respectée.
    let driver = config.webhooks.store;
    let reason = `store explicitement configuré ("${driver}")`;
    if (driver === AUTO_STORE) {
      const auto = resolveAutoStore(
        "durable",
        this.kernel?.infra ?? EMPTY_INFRA,
        listWebhookStores(),
      );
      driver = auto.store;
      reason = auto.reason;
      this.log(`webhooks.store "auto" → "${driver}" (${auto.reason})`, "INFO");
    }
    const factory = getWebhookStoreFactory(driver);
    if (!factory) {
      // Doctrine d'échec : store EXPLICITE introuvable = config erronée.
      // Prod → boot avorté ; dev → brique désactivée, ANNONCÉE.
      const msg =
        `webhooks store "${driver}" inconnu ` +
        `(enregistrés : ${listWebhookStores().join(", ") || "aucun"})`;
      if (this.kernel?.environment === "production") {
        throw new Error(`${msg} — webhooks indisponibles : boot avorté.`);
      }
      this.log(`${msg} — webhooks indisponibles`, "CRITIC");
      return null;
    }
    // Prod-guard : abonnements en mémoire = volatils et per-pod (perdus au
    // redémarrage, non partagés entre pods).
    if (driver === "memory" && this.kernel?.environment === "production") {
      this.log(
        `webhooks.store "memory" en PRODUCTION — abonnements volatils et per-pod : ` +
          `perdus au redémarrage, non partagés entre pods. Déclarer une infra durable ` +
          `(NF_DATABASE_URL).`,
        "WARNING",
      );
    }
    const store = factory({ container: this.container as Container, config });
    this.container?.set("webhookStore", store);
    this.kernel?.registerStoreResolution({
      brick: "webhooks",
      nature: "durable",
      configured: config.webhooks.store,
      resolved: driver,
      available: listWebhookStores(),
      reason,
      configPath: "security.webhooks.store",
      location: readStoreLocation(store),
    });
    return store;
  }

  /** Clé AES-256 du secret au repos. Dev : éphémère + WARNING ; prod : fatal (null). */
  #resolveKey(config: ISecurityConfig): Buffer | null {
    const material = config.webhooks.encryptionKey;
    if (material && material.length > 0) {
      return deriveWebhookKey(material);
    }
    const isProd =
      (this.kernel as { environment?: string } | null)?.environment ===
      "production";
    if (isProd) {
      this.log(
        "webhooks: AUCUNE clé de chiffrement (`security.webhooks.encryptionKey`) en " +
          "PRODUCTION — webhooks désactivés (un secret chiffré par une clé éphémère serait " +
          "illisible après redémarrage / sur les autres pods). Fournir une clé depuis l'environnement.",
        "CRITIC",
      );
      return null;
    }
    this.log(
      "webhooks: aucune clé de chiffrement configurée — clé ÉPHÉMÈRE générée (dev). Les " +
        "secrets de signature ne survivront pas au redémarrage. Définir `webhooks.encryptionKey` " +
        "— générer la clé et le câblage : `npx nodefony security:secrets`.",
      "WARNING",
    );
    return generateEphemeralKey();
  }

  async #reloadSnapshot(): Promise<void> {
    if (!this.#store) return;
    try {
      const all = await this.#store.listAll();
      this.#endpoints = new Map(all.map((e) => [e.id, e]));
    } catch (e) {
      this.log(e as Error, "ERROR");
    }
  }

  // ── API publique ─────────────────────────────────────────────────────────────

  /** Le service est-il opérationnel (activé + store + clé) ? */
  isReady(): boolean {
    return this.#ready;
  }

  /**
   * Enregistre un endpoint : valide l'URL (anti-SSRF), génère un secret de
   * signature, le chiffre au repos. Retourne l'endpoint + le secret **en clair**
   * (la seule occasion de le lire pour le copier).
   *
   * @throws SsrfError si l'URL est invalide / cible non publique.
   */
  async register(input: IWebhookRegisterInput): Promise<IWebhookSecretReveal> {
    this.#assertReady();
    await this.#assertSafeUrl(input.url);
    const secret = generateSecret();
    const now = Date.now();
    const endpoint: IWebhookEndpoint = {
      id: generateId(),
      url: input.url,
      secretEnc: encryptSecret(Buffer.from(secret, "utf8"), this.#key!),
      events: [...input.events],
      enabled: input.enabled ?? true,
      description: input.description ?? null,
      tenantId: input.tenantId ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
      lastDeliveryError: null,
      failureCount: 0,
      metadata: input.metadata ?? {},
    };
    await this.#store!.save(endpoint);
    this.#endpoints?.set(endpoint.id, endpoint);
    return { endpoint: toSummary(endpoint), secret };
  }

  /** Tous les endpoints (vue publique, sans secret). */
  async list(): Promise<WebhookEndpointSummary[]> {
    this.#assertReady();
    const all = await this.#store!.listAll();
    return all.map(toSummary);
  }

  /** Un endpoint par id (vue publique), ou `null`. */
  async getEndpoint(id: string): Promise<WebhookEndpointSummary | null> {
    this.#assertReady();
    const found = await this.#store!.findById(id);
    return found ? toSummary(found) : null;
  }

  /**
   * Met à jour les champs mutables (url/events/enabled/description/metadata).
   * Une nouvelle `url` est re-validée anti-SSRF. Retourne l'endpoint mis à jour,
   * ou `null` si absent.
   */
  async update(
    id: string,
    patch: Pick<
      WebhookEndpointUpdate,
      "url" | "events" | "enabled" | "description" | "metadata"
    >,
  ): Promise<WebhookEndpointSummary | null> {
    this.#assertReady();
    const current = await this.#store!.findById(id);
    if (!current) return null;
    if (patch.url !== undefined && patch.url !== current.url) {
      await this.#assertSafeUrl(patch.url);
    }
    const applied: WebhookEndpointUpdate = { ...patch, updatedAt: Date.now() };
    await this.#store!.update(id, applied);
    const next = { ...current, ...applied };
    this.#endpoints?.set(id, next);
    return toSummary(next);
  }

  /** Active/désactive un endpoint (révocation douce = `false`). */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<WebhookEndpointSummary | null> {
    return this.update(id, { enabled });
  }

  /**
   * Régénère le secret de signature (rotation) et retourne le nouveau en clair.
   * L'ancien cesse immédiatement d'être valide. `null` si l'endpoint est absent.
   */
  async rotateSecret(id: string): Promise<IWebhookSecretReveal | null> {
    this.#assertReady();
    const current = await this.#store!.findById(id);
    if (!current) return null;
    const secret = generateSecret();
    const patch: WebhookEndpointUpdate = {
      secretEnc: encryptSecret(Buffer.from(secret, "utf8"), this.#key!),
      updatedAt: Date.now(),
    };
    await this.#store!.update(id, patch);
    const next = { ...current, ...patch };
    this.#endpoints?.set(id, next);
    return { endpoint: toSummary(next), secret };
  }

  /**
   * Révèle le secret en clair d'un endpoint (réversible — usage admin, à auditer
   * par l'appelant). `null` si absent.
   */
  async revealSecret(id: string): Promise<string | null> {
    this.#assertReady();
    const current = await this.#store!.findById(id);
    if (!current) return null;
    return decryptSecret(current.secretEnc, this.#key!).toString("utf8");
  }

  /** Supprime un endpoint. Retourne `false` si absent. */
  async delete(id: string): Promise<boolean> {
    this.#assertReady();
    const current = await this.#store!.findById(id);
    if (!current) return false;
    await this.#store!.delete(id);
    this.#endpoints?.delete(id);
    this.#deliveries?.delete(id); // purge l'historique en RAM de l'endpoint
    return true;
  }

  /**
   * Historique des dernières livraisons d'un endpoint (plus récentes d'abord) —
   * ce que Nodefony a ENVOYÉ + la réponse observée. RAM, borné, par pod
   * (observabilité éphémère, non persistée). `[]` si aucune livraison.
   */
  listDeliveries(id: string): IWebhookDelivery[] {
    const ring = this.#deliveries?.get(id);
    return ring ? [...ring] : [];
  }

  /**
   * Pousse une trace de livraison dans le ring de l'endpoint (lazy alloc, ring
   * borné `MAX_DELIVERIES_PER_ENDPOINT`, corps tronqué). Appelé par le dispatcher
   * sur l'issue FINALE d'une livraison.
   */
  #recordDelivery(id: string, rec: IWebhookDeliveryRecord): void {
    if (this.#deliveries === null) this.#deliveries = new Map();
    let ring = this.#deliveries.get(id);
    if (ring === undefined) {
      ring = [];
      this.#deliveries.set(id, ring);
    }
    const entry: IWebhookDelivery = {
      ts: Date.now(),
      messageId: rec.messageId,
      type: rec.type,
      attempt: rec.attempt,
      ok: rec.ok,
      status: rec.status,
      error: rec.error,
      durationMs: rec.durationMs,
      requestBody:
        rec.requestBody.length > MAX_RECORDED_BODY
          ? rec.requestBody.slice(0, MAX_RECORDED_BODY)
          : rec.requestBody,
      responseBody: rec.responseBody,
    };
    ring.unshift(entry); // plus récent en tête
    if (ring.length > MAX_DELIVERIES_PER_ENDPOINT) {
      ring.length = MAX_DELIVERIES_PER_ENDPOINT;
    }
  }

  // ── Accessors dispatcher (Slice B) ───────────────────────────────────────────

  /** Snapshot mémoire (sync) des endpoints — itération du dispatcher (si >0). */
  getSnapshot(): IWebhookEndpoint[] {
    return this.#endpoints ? [...this.#endpoints.values()] : [];
  }

  /** Nombre d'endpoints (0-alloc) — court-circuit hot-path du dispatcher. */
  endpointCount(): number {
    return this.#endpoints ? this.#endpoints.size : 0;
  }

  /** Déchiffre le secret de signature d'un endpoint (pour signer une livraison). */
  decryptEndpointSecret(endpoint: IWebhookEndpoint): Buffer {
    this.#assertReady();
    return decryptSecret(endpoint.secretEnc, this.#key!);
  }

  /** Politique de livraison (tolérance/retries/timeout…) issue de la config. */
  getDeliveryPolicy(): IWebhookDeliveryPolicy {
    this.#assertReady();
    const w = this.#config!.webhooks;
    return {
      timestampToleranceS: w.timestampToleranceS,
      maxRetries: w.maxRetries,
      autoDisableThreshold: w.autoDisableThreshold,
      deliveryTimeoutMs: w.deliveryTimeoutMs,
      maxConcurrent: w.maxConcurrent,
      maxQueue: w.maxQueue,
      allowHttp: w.allowHttp,
      denyPrivateIps: w.denyPrivateIps,
    };
  }

  /**
   * Enregistre le résultat d'une livraison (appelé par le dispatcher) :
   * lastDelivery*, compteur d'échecs consécutifs, et **auto-désactivation** de
   * l'endpoint au-delà du seuil (façon GitHub). Le succès remet le compteur à 0.
   */
  async markDelivery(id: string, result: IDeliveryResult): Promise<void> {
    if (!this.#ready || !this.#store) return;
    const current = await this.#store.findById(id);
    if (!current) return;
    const failureCount = result.ok ? 0 : current.failureCount + 1;
    const now = Date.now();
    const threshold = this.#config!.webhooks.autoDisableThreshold;
    const disable = !result.ok && threshold > 0 && failureCount >= threshold;
    const patch: WebhookEndpointUpdate = {
      lastDeliveryAt: now,
      lastDeliveryStatus: result.status,
      lastDeliveryError: result.error,
      failureCount,
      updatedAt: now,
      ...(disable ? { enabled: false } : {}),
    };
    if (disable) {
      this.log(
        `webhook ${id} auto-désactivé après ${failureCount} échecs consécutifs`,
        "WARNING",
      );
      // Signal d'audit BORNÉ (1 par endpoint qui meurt) — pas chaque échec.
      this.#audit?.record({
        category: "webhook",
        action: "webhook.disabled",
        outcome: "failure",
        actor: null,
        resource: id,
        reason: "max_failures",
      });
    }
    await this.#store.update(id, patch);
    this.#endpoints?.set(id, { ...current, ...patch });
  }

  // ── Interne ──────────────────────────────────────────────────────────────────

  #assertReady(): void {
    if (!this.#ready || !this.#store || !this.#key) {
      throw new Error("webhooks indisponibles (désactivés ou mal configurés)");
    }
  }

  async #assertSafeUrl(url: string): Promise<void> {
    const w = this.#config!.webhooks;
    await assertPublicUrl(url, {
      allowPrivate: !w.denyPrivateIps,
      allowHttp: w.allowHttp,
    });
  }

  /** Re-contrôle SSRF avant livraison → IP validées à pinner (anti-rebinding). */
  async #resolveTarget(url: string): Promise<string[]> {
    const w = this.#config!.webhooks;
    const { addresses } = await assertPublicUrl(url, {
      allowPrivate: !w.denyPrivateIps,
      allowHttp: w.allowHttp,
    });
    return addresses;
  }
}

export { WebhookService };
export default WebhookService;
