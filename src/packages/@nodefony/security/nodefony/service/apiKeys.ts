import { Service, Module, Container, Event, type IPage } from "nodefony";
import { randomUUID } from "node:crypto";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import type {
  ITokenStore,
  IAccessTokenRecord,
  ITokenListQuery,
} from "../contracts/ITokenStore";
import type {
  IApiKeyView,
  IApiKeyCreated,
  IApiKeyCapabilities,
  ICreateApiKeyOptions,
} from "../contracts/IApiKey";
import { ApiKeyError } from "../errors/ApiKeyError";
import { generateApiKey } from "../src/apikey/apiKeyFormat";
import { recordAudit } from "../src/audit/recordAudit";

const serviceName = "apiKeys";
const MAX_NAME_LEN = 100;
const MS_PER_DAY = 86_400_000;

/**
 * Gestion des **clés API personnelles (PAT, P6.12)** — émission, listing et
 * révocation, au-dessus du `ITokenStore` **partagé** (posé au container par le
 * `TokenService`, qui en possède aussi le `gc`). Un PAT et un refresh token
 * cohabitent dans la même table (`kind`) ; ce service ne traite que `kind:"pat"`.
 *
 * **Sécurité** : le secret (256 bits aléatoires) n'est rendu en clair qu'à la
 * création (`IApiKeyCreated.token`, RFC « shown once ») ; seul son `sha256` est
 * persisté. Création/révocation s'appliquent **toujours à un porteur donné**
 * (jamais à autrui) — l'identité est résolue côté endpoint (session BFF). La
 * vérification d'une clé présentée vit, elle, dans `ApiKeyAuthenticator`.
 *
 * Le store est résolu **paresseusement** du container (`tokenStore`) au premier
 * usage : indépendant de l'ordre de boot des services.
 */
class ApiKeyService extends Service {
  #store: ITokenStore | null = null;
  #enabled = false;
  #prefix = "nf";
  #defaultExpiryDays: number | null = 90;
  #maxPerSubject = 100;
  #allowedScopes: string[] | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface
      // (les clés resteront indisponibles → 503 à la création/listing).
      return;
    }
    const ak = config.apiKeys;
    if (!ak.enabled) {
      this.log("api keys idle — désactivées en config", "DEBUG");
      return;
    }
    this.#enabled = true;
    this.#prefix = ak.prefix;
    this.#defaultExpiryDays = ak.defaultExpiryDays;
    this.#maxPerSubject = ak.maxPerSubject;
    this.#allowedScopes = ak.allowedScopes;
    this.log(
      `api keys ready — prefix "${ak.prefix}_", max ${ak.maxPerSubject}/porteur`,
      "DEBUG",
    );
  }

  /** `true` si les clés API sont activées en config. */
  isEnabled(): boolean {
    return this.#enabled;
  }

  /**
   * Champs de tri que le backend **actuellement branché** sait honorer, en
   * vocabulaire public. Le data plane admin les passe en allowlist au traducteur
   * de requête de page : hors de cette liste, un `?order=` est refusé en 400.
   *
   * La liste vient du store, jamais d'une constante recopiée ici : c'est ce qui
   * fait qu'un backend à capacité réduite (Redis, dont le `SCAN` n'a pas d'ordre
   * global) refuse le tri **sans qu'aucune règle supplémentaire ne soit écrite**.
   * Store absent ou indisponible → aucune capacité annoncée, donc aucun tri promis.
   *
   * @returns les champs triables, ou un tableau vide.
   */
  sortableFields(): readonly string[] {
    try {
      return this.#resolveStore().sortableFields ?? [];
    } catch {
      // `#resolveStore` lève 503 quand rien n'est branché : l'introspection d'une
      // capacité ne doit jamais casser la page qui l'interroge.
      return [];
    }
  }

  /**
   * Émet une nouvelle clé API pour un porteur — renvoie sa vue publique **+ le
   * token en clair** (affiché une seule fois).
   *
   * @throws ApiKeyError 400 — nom vide/trop long, scope hors catalogue, expiry invalide.
   * @throws ApiKeyError 409 — plafond `maxPerSubject` atteint.
   * @throws ApiKeyError 503 — store indisponible.
   */
  async createForSubject(
    subjectId: string,
    subjectType: "user" | "service",
    opts: ICreateApiKeyOptions,
  ): Promise<IApiKeyCreated> {
    const store = this.#resolveStore();
    const name = this.#normalizeName(opts.name);
    const scopes = this.#normalizeScopes(opts.scopes);
    const now = Date.now();
    const expiresAt = this.#resolveExpiry(opts.expiresInDays, now);

    // Plafond anti-abus : ne compte que les PAT ACTIFS (ni révoqués ni expirés).
    const active = (await store.findBySubject(subjectId)).filter(
      (r) => r.kind === "pat" && this.#isActive(r, now),
    );
    if (active.length >= this.#maxPerSubject) {
      throw new ApiKeyError(
        `API key limit reached (${this.#maxPerSubject})`,
        409,
      );
    }

    const generated = generateApiKey(this.#prefix);
    const record: IAccessTokenRecord = {
      id: randomUUID(),
      kind: "pat",
      name,
      prefix: generated.publicPrefix,
      subjectId,
      subjectType,
      tenantId: opts.tenantId ?? null,
      scopes,
      audience: [],
      resources: null,
      secretHash: generated.secretHash,
      hashAlg: "sha256",
      clientId: null,
      cnf: null,
      family: null,
      replacedBy: null,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedUserAgent: null,
      revokedAt: null,
      revokedReason: null,
      metadata: {},
    };
    await store.put(record);
    // Audit (P6.14 lot 2b) — JAMAIS le secret, seulement l'id public.
    this.log(
      `api key created — id=${record.id} subject=${subjectId} scopes=[${scopes.join(",")}]`,
      "INFO",
    );
    recordAudit(this.container as Container, {
      category: "token",
      action: "apikey.created",
      outcome: "success",
      actor: subjectId,
      resource: record.id,
      metadata: { scopes, subjectType },
    });
    return { ...this.#toView(record), token: generated.token };
  }

  /** Liste les clés (PAT) d'un porteur — vue publique, sans secret, récentes d'abord. */
  async listForSubject(subjectId: string): Promise<IApiKeyView[]> {
    const store = this.#resolveStore();
    return (await store.findBySubject(subjectId))
      .filter((r) => r.kind === "pat")
      .map((r) => this.#toView(r))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Liste **paginée** des clés (PAT) du système, tous porteurs confondus — vue
   * d'ADMINISTRATION (gouvernance / réponse à incident), publique et sans secret.
   * Réservé au data plane admin (RBAC `ROLE_NODEFONY_ADMIN`) : l'identité du porteur
   * (`subjectId`) est exposée pour la supervision.
   *
   * Pagination **native au store** (jamais un `listAll()` matérialisé en RAM) : `kind`
   * est forcé à `"pat"` ; les autres filtres (`subjectId`/`revoked`) + la fenêtre
   * (`limit`/`offset`/`cursor`) viennent de `query`. Tri `createdAt` DESC par défaut.
   *
   * @param query - filtres + fenêtre de page ({@link ITokenListQuery}, `kind` ignoré).
   * @returns une page de vues publiques ({@link IApiKeyView}, sans secret).
   */
  async listPagePat(query: ITokenListQuery): Promise<IPage<IApiKeyView>> {
    const store = this.#resolveStore();
    const page = await store.listPage({ ...query, kind: "pat" });
    return { ...page, items: page.items.map((r) => this.#toView(r)) };
  }

  /**
   * Révoque **n'importe quelle** clé (PAT) — action d'ADMINISTRATION (réponse à
   * incident : clé compromise), SANS contrainte de porteur (≠ `revokeForSubject`).
   * Audité avec l'acteur admin ET le porteur cible. Idempotent.
   *
   * @param id - identifiant public de la clé.
   * @param actorId - identité de l'admin qui révoque (tracée pour l'audit).
   * @returns la vue publique mise à jour, ou `null` si introuvable / pas un PAT.
   */
  async revokeAnyPat(id: string, actorId: string): Promise<IApiKeyView | null> {
    const store = this.#resolveStore();
    const record = await store.findById(id);
    if (!record || record.kind !== "pat") {
      return null;
    }
    await store.revoke(id, "manual");
    this.log(
      `api key revoked by admin — id=${id} actor=${actorId} subject=${record.subjectId}`,
      "INFO",
    );
    recordAudit(this.container as Container, {
      category: "token",
      action: "apikey.revoked",
      outcome: "success",
      actor: actorId,
      resource: id,
      reason: "manual",
      metadata: { subject: record.subjectId, viaAdmin: true },
    });
    const updated = await store.findById(id);
    return updated ? this.#toView(updated) : null;
  }

  /**
   * Capacités/contraintes d'émission (plafond, scopes, préfixe, durée par défaut)
   * — pour un formulaire de création honnête côté console. Aucune valeur sensible.
   */
  describeCapabilities(): IApiKeyCapabilities {
    return {
      enabled: this.#enabled,
      prefix: this.#prefix,
      defaultExpiryDays: this.#defaultExpiryDays,
      maxPerSubject: this.#maxPerSubject,
      allowedScopes:
        this.#allowedScopes === null ? null : [...this.#allowedScopes],
    };
  }

  /**
   * Révoque une clé du porteur. **Anti-énumération** : une clé inexistante OU
   * appartenant à autrui renvoie `false` (« introuvable pour ce porteur ») —
   * jamais un 403 qui révélerait son existence. Idempotent (déjà révoquée → `true`).
   *
   * @returns `true` si la clé du porteur a été trouvée (et révoquée), sinon `false`.
   */
  async revokeForSubject(subjectId: string, id: string): Promise<boolean> {
    const store = this.#resolveStore();
    const record = await store.findById(id);
    if (!record || record.kind !== "pat" || record.subjectId !== subjectId) {
      return false;
    }
    await store.revoke(id, "manual");
    this.log(`api key revoked — id=${id} subject=${subjectId}`, "INFO");
    recordAudit(this.container as Container, {
      category: "token",
      action: "apikey.revoked",
      outcome: "success",
      actor: subjectId,
      resource: id,
      reason: "manual",
    });
    return true;
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #resolveStore(): ITokenStore {
    if (this.#store === null) {
      const store = this.get<ITokenStore>("tokenStore");
      if (!store) {
        // Clés activées mais store non provisionné (TokenService désactivé) :
        // misconfiguration → 503, jamais une 500 opaque.
        throw new ApiKeyError("API key store unavailable", 503);
      }
      this.#store = store;
    }
    return this.#store;
  }

  #normalizeName(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new ApiKeyError("API key name is required", 400);
    }
    const name = raw.trim();
    if (name.length > MAX_NAME_LEN) {
      throw new ApiKeyError(`API key name too long (max ${MAX_NAME_LEN})`, 400);
    }
    return name;
  }

  #normalizeScopes(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new ApiKeyError("scopes must be an array of strings", 400);
    }
    const scopes: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new ApiKeyError("invalid scope", 400);
      }
      const scope = entry.trim();
      if (
        this.#allowedScopes !== null &&
        !this.#allowedScopes.includes(scope)
      ) {
        throw new ApiKeyError(`scope not allowed: ${scope}`, 400);
      }
      if (!scopes.includes(scope)) scopes.push(scope);
    }
    return scopes;
  }

  #resolveExpiry(
    expiresInDays: number | null | undefined,
    now: number,
  ): number | null {
    const days =
      expiresInDays === undefined ? this.#defaultExpiryDays : expiresInDays;
    if (days === null) return null;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
      throw new ApiKeyError(
        "expiresInDays must be a positive number or null",
        400,
      );
    }
    return now + days * MS_PER_DAY;
  }

  #isActive(record: IAccessTokenRecord, now: number): boolean {
    return (
      record.revokedAt === null &&
      (record.expiresAt === null || record.expiresAt > now)
    );
  }

  #toView(record: IAccessTokenRecord): IApiKeyView {
    return {
      id: record.id,
      prefix: record.prefix,
      name: record.name,
      scopes: [...record.scopes],
      subjectId: record.subjectId,
      subjectType: record.subjectType,
      tenantId: record.tenantId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      lastUsedIp: record.lastUsedIp,
      lastUsedUserAgent: record.lastUsedUserAgent,
      revokedAt: record.revokedAt,
    };
  }
}

export default ApiKeyService;
export { ApiKeyService };
