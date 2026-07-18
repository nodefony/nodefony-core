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
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import type { IPage } from "nodefony";
import type {
  ITotpEnrollmentSummary,
  ITotpListQuery,
  ITotpSecretStore,
} from "../contracts/ITotpSecretStore";
import {
  getTotpStoreFactory,
  listTotpStores,
} from "../src/totp/totpSecretStoreRegistry";
import { deriveTotpKey, generateEphemeralKey } from "../src/totp/totpCipher";
import {
  type ITotpDeps,
  type ITotpEnrollment,
  type ITotpActivation,
  type ITotpStatus,
  type ITotpLoginResult,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  verifyTotpLogin,
  disableTotp,
  totpStatus,
} from "../src/totp/totpOperations";

const serviceName = "totp";

/** Store capable d'écrire son état sur disque à l'arrêt (driver `file`). */
interface IFlushableStore {
  flushNow(): Promise<void>;
}
function isFlushable(s: unknown): s is IFlushableStore {
  return (
    s !== null && typeof (s as { flushNow?: unknown }).flushNow === "function"
  );
}

/**
 * **2FA TOTP** (P6.17, RFC 6238) — service d'orchestration du second facteur.
 *
 * Coquille fine : au boot (si `totp.enabled`) il résout le **store** de secrets
 * pluggable + la **clé de chiffrement** AES-256-GCM, puis délègue toute la logique
 * aux opérations pures `totpOperations` (testées sans serveur). Le TOTP est un
 * facteur de **login step-up** (le code n'est présenté qu'à la connexion, calque
 * WebAuthn/OAuth), pas un authenticator du firewall — `session.user` n'est posé
 * qu'une fois le second facteur validé (Zero Trust 401 protège tout le reste).
 *
 * **Clé de chiffrement** : le secret TOTP est réversible (le serveur le relit pour
 * calculer le code) → chiffré, jamais haché. La clé vient de `totp.encryptionKey`
 * (dérivée HKDF). Absente : en dev une clé **éphémère** est générée + WARNING (les
 * secrets ne survivent pas au redémarrage) ; en **production** c'est fatal — 2FA
 * désactivé (une clé éphémère rendrait les secrets illisibles après redémarrage /
 * sur les autres pods). Politique calquée sur RedisIdempotencyStore.
 */
class TotpService extends Service {
  #deps: ITotpDeps | null = null;
  #store: ITotpSecretStore | null = null;
  #ready = false;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
    this.kernel?.once("onTerminate", () => void this.#shutdown());
  }

  // ── Cycle de vie ─────────────────────────────────────────────────────────────

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge déjà CRITIC + fail-closed. On s'efface
      // (2FA indisponible → les endpoints d'enrôlement 503, le login ignore le 2FA).
      return;
    }
    if (!config.totp.enabled) {
      this.log("totp idle — 2FA désactivé en config", "DEBUG");
      return;
    }
    const store = this.#resolveStore(config);
    if (!store) {
      return;
    }
    const key = this.#resolveKey(config);
    if (!key) {
      return;
    }
    this.#store = store;
    this.#deps = {
      store,
      key,
      now: () => Date.now(),
      issuer: config.totp.issuer ?? this.#defaultIssuer(),
      algorithm: config.totp.algorithm,
      digits: config.totp.digits,
      period: config.totp.period,
      window: config.totp.window,
      recoveryCodesCount: config.totp.recoveryCodes,
    };
    this.#ready = true;
    this.log(
      `totp ready — store "${config.totp.store}", ${config.totp.digits} chiffres / ${config.totp.period}s`,
      "DEBUG",
    );
  }

  /**
   * Résout le store de secrets : adapter posé au container (ORM/Redis) en priorité,
   * sinon le driver configuré. `auto` (défaut) suit l'infra database déclarée puis
   * un backend local persistant (sqlite/drizzle chargé), repli `memory` ANNONCÉ.
   */
  #resolveStore(config: ISecurityConfig): ITotpSecretStore | null {
    const existing = this.get<ITotpSecretStore>("totpSecretStore");
    if (existing) {
      this.kernel?.registerStoreResolution({
        brick: "totp",
        nature: "durable",
        configured: config.totp.store,
        resolved: deriveStoreBackend(existing),
        available: listTotpStores(),
        reason: "adapter posé au container (infra database déclarée)",
        configPath: "security.totp.store",
        location: readStoreLocation(existing),
      });
      return existing;
    }
    let driver = config.totp.store;
    let reason = `store explicitement configuré ("${driver}")`;
    if (driver === AUTO_STORE) {
      const auto = resolveAutoStore(
        "durable",
        this.kernel?.infra ?? EMPTY_INFRA,
        listTotpStores(),
      );
      driver = auto.store;
      reason = auto.reason;
      this.log(`totp.store "auto" → "${driver}" (${auto.reason})`, "INFO");
    }
    const factory = getTotpStoreFactory(driver);
    if (!factory) {
      // Doctrine d'échec : store EXPLICITE introuvable = config erronée.
      const msg =
        `totp store "${driver}" inconnu ` +
        `(enregistrés : ${listTotpStores().join(", ") || "aucun"})`;
      if (this.kernel?.environment === "production") {
        throw new Error(`${msg} — 2FA indisponible : boot avorté.`);
      }
      this.log(`${msg} — 2FA indisponible`, "CRITIC");
      return null;
    }
    // Prod-guard : secrets 2FA en mémoire = perdus au redémarrage (utilisateurs
    // verrouillés hors de leur second facteur).
    if (driver === "memory" && this.kernel?.environment === "production") {
      this.log(
        `totp.store "memory" en PRODUCTION — secrets 2FA volatils : perdus au ` +
          `redémarrage (utilisateurs verrouillés). Déclarer une infra durable ` +
          `(NF_DATABASE_URL) ou charger @nodefony/drizzle.`,
        "WARNING",
      );
    }
    const store = factory({ container: this.container as Container, config });
    this.container?.set("totpSecretStore", store);
    this.kernel?.registerStoreResolution({
      brick: "totp",
      nature: "durable",
      configured: config.totp.store,
      resolved: driver,
      available: listTotpStores(),
      reason,
      configPath: "security.totp.store",
      location: readStoreLocation(store),
    });
    return store;
  }

  /**
   * Résout la clé de chiffrement AES-256 du secret au repos. Clé de config →
   * dérivée HKDF. Absente : dev = clé éphémère + WARNING ; prod = fatal (null →
   * 2FA désactivé), pour ne jamais chiffrer un secret avec une clé non
   * reproductible (illisible après redémarrage ou sur un autre pod).
   */
  #resolveKey(config: ISecurityConfig): Buffer | null {
    const material = config.totp.encryptionKey;
    if (material && material.length > 0) {
      return deriveTotpKey(material);
    }
    const isProd =
      (this.kernel as { environment?: string } | null)?.environment ===
      "production";
    if (isProd) {
      this.log(
        "totp: AUCUNE clé de chiffrement (`security.totp.encryptionKey`) en PRODUCTION — " +
          "2FA désactivé (un secret chiffré par une clé éphémère serait illisible après " +
          "redémarrage / sur les autres pods). Fournir une clé ≥ 32 octets depuis l'environnement.",
        "CRITIC",
      );
      return null;
    }
    this.log(
      "totp: aucune clé de chiffrement configurée — clé ÉPHÉMÈRE générée (dev). Les secrets " +
        "2FA ne survivront pas au redémarrage. Définir `totp.encryptionKey` — générer la clé " +
        "et le câblage : `npx nodefony security:secrets`.",
      "WARNING",
    );
    return generateEphemeralKey();
  }

  /**
   * Arrêt propre : flush immédiat du store s'il est persistant (driver `file`) →
   * aucune écriture en attente n'est perdue. No-op pour un store mémoire/adapter.
   */
  async #shutdown(): Promise<void> {
    if (isFlushable(this.#store)) {
      try {
        await this.#store.flushNow();
      } catch (e) {
        this.log(e as Error, "ERROR");
      }
    }
  }

  // ── API publique (déléguée aux opérations pures) ─────────────────────────────

  /** `true` si le 2FA est opérationnel (activé en config, boot OK). */
  isEnabled(): boolean {
    return this.#ready;
  }

  /** Démarre l'enrôlement (secret + QR affichés 1×). */
  beginEnrollment(userId: string, account: string): Promise<ITotpEnrollment> {
    return beginTotpEnrollment(this.#ensureReady(), userId, account);
  }

  /** Confirme l'enrôlement par un 1ᵉʳ code → active + codes de récupération clairs. */
  confirmEnrollment(userId: string, code: string): Promise<ITotpActivation> {
    return confirmTotpEnrollment(this.#ensureReady(), userId, code);
  }

  /** Vérifie un second facteur au login (code TOTP ou code de récupération). */
  verifyLogin(userId: string, code: string): Promise<ITotpLoginResult> {
    return verifyTotpLogin(this.#ensureReady(), userId, code);
  }

  /** Désactive le 2FA d'un utilisateur. */
  disable(userId: string): Promise<void> {
    return disableTotp(this.#ensureReady(), userId);
  }

  /** État 2FA d'un utilisateur (absent / pending / activé + codes restants). */
  status(userId: string): Promise<ITotpStatus> {
    return totpStatus(this.#ensureReady(), userId);
  }

  /**
   * Page d'enrôlements 2FA — pagination **native au store** (jamais un parcours
   * complet). Vue sans secret ni condensats, garantie par le contrat du store.
   *
   * @param query - fenêtre + filtres ({@link ITotpListQuery}).
   * @returns la page d'enrôlements.
   */
  listPage(query: ITotpListQuery): Promise<IPage<ITotpEnrollmentSummary>> {
    return this.#ensureReady().store.listPage(query);
  }

  /**
   * Nombre d'enrôlements correspondant aux filtres — le KPI « couverture 2FA »
   * sans énumérer.
   *
   * @param query - filtres ({@link ITotpListQuery}) ; `limit` ignoré.
   * @returns le compte exact.
   */
  countEnrollments(query: ITotpListQuery): Promise<number> {
    return this.#ensureReady().store.countEnrollments(query);
  }

  /** 2FA activé pour cet utilisateur ? (raccourci pour le flow de login). */
  async isEnabledFor(userId: string): Promise<boolean> {
    if (!this.#ready || !this.#deps) {
      return false;
    }
    return (await totpStatus(this.#deps, userId)).enabled;
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #defaultIssuer(): string {
    const name = (this.kernel as { projectName?: string } | null)?.projectName;
    return name && name !== "NODEFONY" ? name : "Nodefony";
  }

  #ensureReady(): ITotpDeps {
    if (!this.#ready || !this.#deps) {
      throw new Error(
        "TotpService: non initialisé (2FA désactivé ou boot échoué)",
      );
    }
    return this.#deps;
  }
}

export default TotpService;
export { TotpService };
