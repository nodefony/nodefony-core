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
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type * as SimpleWebAuthnServer from "@simplewebauthn/server";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import { AuthenticationError } from "../errors/AuthenticationError";
import { WebAuthnError } from "../errors/WebAuthnError";
import type { IPage } from "nodefony";
import type { IWebAuthnCredential } from "../contracts/IWebAuthnCredential";
import type {
  IWebAuthnCredentialStore,
  IWebAuthnCredentialSummary,
  IWebAuthnListQuery,
} from "../contracts/IWebAuthnCredentialStore";
import {
  getWebAuthnStoreFactory,
  listWebAuthnStores,
} from "../src/webauthn/webAuthnCredentialStoreRegistry";

const serviceName = "webauthn";

type Lib = typeof SimpleWebAuthnServer;

/** Store capable d'écrire son état sur disque à l'arrêt (driver `file`). */
interface IFlushableStore {
  flushNow(): Promise<void>;
}
function isFlushable(s: unknown): s is IFlushableStore {
  return (
    s !== null && typeof (s as { flushNow?: unknown }).flushNow === "function"
  );
}

/** Sujet d'une cérémonie d'enregistrement — l'utilisateur qui crée un passkey. */
export interface IWebAuthnUser {
  /** Identifiant applicatif stable (sub / username) — devient le `userHandle`. */
  readonly id: string;
  /** Nom de compte affiché par l'OS (email, identifiant…). */
  readonly name: string;
  /** Nom complet optionnel (UX de l'invite système). */
  readonly displayName?: string;
}

/** Résultat d'une authentification WebAuthn vérifiée. */
export interface IWebAuthnAssertionResult {
  /** Le credential résolu (état déjà mis à jour : compteur, sauvegarde, usage). */
  readonly credential: IWebAuthnCredential;
  /** Identifiant de l'utilisateur propriétaire du credential. */
  readonly userId: string;
}

/**
 * **WebAuthn / passkeys** (P6 J9) — orchestrateur des deux cérémonies FIDO2
 * (WebAuthn L3 §7.1 enregistrement, §7.2 authentification).
 *
 * MFA **phishing-resistant** : la clé privée ne quitte jamais l'authenticator
 * (Touch ID, Windows Hello, clé FIDO). Le serveur ne manipule QUE des clés
 * publiques + vérifie des signatures. La vérification cryptographique (parsing
 * CBOR/COSE, signatures ES256/RS256/EdDSA) est déléguée à `@simplewebauthn/server`
 * (lib auditée de l'écosystème), **importée paresseusement** au 1ᵉʳ usage (cold
 * path — l'enregistrement/login n'est pas le hot path par requête).
 *
 * Au boot (si `passkeys.enabled`) : résout le RP (rpID/rpName/origines depuis la
 * config, sinon le domaine de l'app) + le store de credentials pluggable
 * (`webAuthnCredentialStore` du container, sinon le builtin mémoire) et le pose
 * au container (consommé par `WebAuthnAuthenticator` et les endpoints framework).
 *
 * **Anti-rejeu** : le challenge serveur est porté HORS de ce service (en session
 * BFF par le controller) ; chaque `verify*` reçoit le `expectedChallenge` qu'il
 * a émis — un challenge n'est jamais réutilisable.
 */
class WebAuthnService extends Service {
  #config: ISecurityConfig | null = null;
  #lib: Lib | null = null;
  #store: IWebAuthnCredentialStore | null = null;
  #rpID = "localhost";
  #rpName = "Nodefony";
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
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface
      // (passkeys indisponibles → l'authenticator refuse, les endpoints 503).
      return;
    }
    if (!config.passkeys.enabled) {
      this.log("webauthn idle — passkeys désactivés en config", "DEBUG");
      return;
    }
    this.#config = config;
    const rawDomain =
      config.passkeys.rpId ??
      ((this.kernel as { domain?: string } | null)?.domain || "localhost");
    // rpId WebAuthn DOIT être un domaine enregistrable ou « localhost » — une
    // adresse IP (dev : 127.0.0.1 / 0.0.0.0, ou IPv6) est REFUSÉE par le
    // navigateur. On bascule alors sur « localhost » (l'unique host non-domaine
    // autorisé) → l'accès doit se faire via http(s)://localhost:<port>.
    this.#rpID = /^(\d{1,3}\.){3}\d{1,3}$|:/.test(rawDomain)
      ? "localhost"
      : rawDomain;
    this.#rpName = config.passkeys.rpName ?? "Nodefony";

    // Store des credentials : adapter posé au container (ORM/Redis) en priorité,
    // sinon le driver configuré (`memory` | `file`) via le registre de fabriques.
    const existing = this.get<IWebAuthnCredentialStore>(
      "webAuthnCredentialStore",
    );
    let resolved: string;
    let reason: string;
    if (existing) {
      this.#store = existing;
      resolved = deriveStoreBackend(existing);
      reason = "adapter posé au container (infra database déclarée)";
    } else {
      // `auto` (défaut) = suivre l'infra database déclarée, borné aux backends
      // enregistrés ; repli memory ANNONCÉ. Valeur explicite respectée.
      let driver = config.passkeys.store;
      reason = `store explicitement configuré ("${driver}")`;
      if (driver === AUTO_STORE) {
        const auto = resolveAutoStore(
          "durable",
          this.kernel?.infra ?? EMPTY_INFRA,
          listWebAuthnStores(),
        );
        driver = auto.store;
        reason = auto.reason;
        this.log(
          `passkeys.store "auto" → "${driver}" (${auto.reason})`,
          "INFO",
        );
      }
      const factory = getWebAuthnStoreFactory(driver);
      if (!factory) {
        // Doctrine d'échec : store EXPLICITE introuvable = config erronée.
        // Prod → boot avorté ; dev → brique désactivée, ANNONCÉE.
        const msg =
          `webauthn store "${driver}" inconnu ` +
          `(enregistrés : ${listWebAuthnStores().join(", ") || "aucun"})`;
        if (this.kernel?.environment === "production") {
          throw new Error(`${msg} — passkeys indisponibles : boot avorté.`);
        }
        this.log(`${msg} — passkeys indisponibles`, "CRITIC");
        return;
      }
      // Prod-guard : credentials WebAuthn en mémoire = tous les passkeys
      // enregistrés perdus au redémarrage (utilisateurs verrouillés dehors).
      if (driver === "memory" && this.kernel?.environment === "production") {
        this.log(
          `passkeys.store "memory" en PRODUCTION — credentials WebAuthn volatils : tous ` +
            `les passkeys enregistrés sont perdus au redémarrage (utilisateurs verrouillés ` +
            `hors de leur compte). Déclarer une infra durable (NF_DATABASE_URL).`,
          "WARNING",
        );
      }
      this.#store = factory({ container: this.container as Container, config });
      this.container?.set("webAuthnCredentialStore", this.#store);
      resolved = driver;
    }
    this.kernel?.registerStoreResolution({
      brick: "passkeys",
      nature: "durable",
      configured: config.passkeys.store,
      resolved,
      available: listWebAuthnStores(),
      reason,
      configPath: "security.passkeys.store",
      location: readStoreLocation(this.#store),
    });
    this.#ready = true;
    this.log(
      `webauthn ready — rpID "${this.#rpID}", store "${config.passkeys.store}"`,
      "DEBUG",
    );
  }

  /**
   * Arrêt propre : écrit immédiatement le store sur disque s'il est persistant
   * (driver `file`) → aucune écriture en attente de flush n'est perdue au
   * redémarrage. No-op pour un store mémoire ou un adapter sans `flushNow`.
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

  /** `true` si les cérémonies sont opérationnelles (passkeys activés, boot OK). */
  isEnabled(): boolean {
    return this.#ready;
  }

  // ── Enregistrement (WebAuthn §7.1) ───────────────────────────────────────────

  /**
   * Prépare les options de `navigator.credentials.create()` — le défi à signer +
   * les contraintes (RP, type d'attestation, sélection d'authenticator). Le
   * challenge renvoyé doit être stocké côté serveur (session) par l'appelant.
   *
   * `excludeCredentials` liste les passkeys déjà enregistrés du même utilisateur
   * pour empêcher un double enregistrement sur le même authenticator (§7.1).
   */
  async generateRegistrationOptions(
    user: IWebAuthnUser,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.#ensureReady();
    const lib = await this.#ensureLib();
    const pk = this.#config!.passkeys;
    const existing = await this.#store!.findByUser(user.id);
    return lib.generateRegistrationOptions({
      rpName: this.#rpName,
      rpID: this.#rpID,
      userName: user.name,
      userID: new Uint8Array(Buffer.from(user.id, "utf8")),
      userDisplayName: user.displayName ?? user.name,
      attestationType: pk.attestation,
      timeout: pk.timeoutMs,
      excludeCredentials: existing.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: pk.residentKey,
        userVerification: pk.userVerification,
        // 'platform' (défaut) = Touch ID/Windows Hello uniquement (zéro QR) ;
        // 'any' = laisse le navigateur proposer (téléphone via QR inclus).
        ...(pk.authenticatorAttachment !== "any"
          ? { authenticatorAttachment: pk.authenticatorAttachment }
          : {}),
      },
    });
  }

  /**
   * Vérifie la réponse d'enregistrement (challenge, origine, rpIdHash, flags,
   * format d'attestation) et **persiste** le nouveau credential.
   *
   * @param expectedChallenge - le challenge émis par {@link generateRegistrationOptions} (session).
   * @param userId - propriétaire du credential (utilisateur authentifié/en création).
   * @param requestOrigin - origine HTTP de la requête (validée si aucune origine n'est configurée).
   * @throws AuthenticationError (401) — vérification échouée.
   * @throws WebAuthnError (409) — plafond `passkeys.maxPerUser` atteint.
   */
  async verifyRegistration(
    response: RegistrationResponseJSON,
    expectedChallenge: string,
    userId: string,
    requestOrigin?: string,
  ): Promise<IWebAuthnCredential> {
    this.#ensureReady();
    const lib = await this.#ensureLib();
    const pk = this.#config!.passkeys;
    let verification: Awaited<
      ReturnType<typeof lib.verifyRegistrationResponse>
    >;
    try {
      verification = await lib.verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.#expectedOrigin(requestOrigin),
        expectedRPID: this.#rpID,
        requireUserVerification: pk.userVerification === "required",
      });
    } catch {
      // Challenge/origine/rpId/signature/flags invalides → message uniforme.
      throw new AuthenticationError("WebAuthn registration failed");
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new AuthenticationError("WebAuthn registration failed");
    }
    // Plafond APRÈS vérification cryptographique, AVANT le `save` : c'est le
    // `save` qu'il faut garder, pas la génération d'options (un client peut
    // poster directement `register/verify` sans passer par `register/options`).
    const enrolled = await this.#store!.countByUser(userId);
    if (enrolled >= pk.maxPerUser) {
      throw new WebAuthnError(`passkey limit reached (${pk.maxPerUser})`, 409);
    }
    const info = verification.registrationInfo;
    const credential: IWebAuthnCredential = {
      id: info.credential.id,
      userId,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      signCount: info.credential.counter,
      transports: info.credential.transports ?? [],
      // BE flag (eligible) ≈ credential multi-appareils ; BS flag = sauvegardé.
      backupEligible: info.credentialDeviceType === "multiDevice",
      backupState: info.credentialBackedUp,
      uvInitialized: info.userVerified,
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    await this.#store!.save(credential);
    return credential;
  }

  // ── Authentification (WebAuthn §7.2) ─────────────────────────────────────────

  /**
   * Prépare les options de `navigator.credentials.get()`. Sans `userId`
   * (usernameless) : `allowCredentials` est omis → l'authenticator propose ses
   * passkeys découvrables (UX cible). Avec `userId` : ciblage des credentials
   * connus de cet utilisateur.
   */
  async generateAuthenticationOptions(
    userId?: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.#ensureReady();
    const lib = await this.#ensureLib();
    const pk = this.#config!.passkeys;
    let allowCredentials:
      { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
    if (userId) {
      const creds = await this.#store!.findByUser(userId);
      allowCredentials = creds.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      }));
    }
    return lib.generateAuthenticationOptions({
      rpID: this.#rpID,
      allowCredentials,
      userVerification: pk.userVerification,
      timeout: pk.timeoutMs,
    });
  }

  /**
   * Vérifie une assertion (signature sur `authData ‖ SHA-256(clientDataJSON)`
   * avec la clé publique stockée, §7.2) + applique l'état (compteur anti-clone,
   * sauvegarde, usage). Résout l'utilisateur propriétaire via le credentialId.
   *
   * @param expectedChallenge - le challenge émis par {@link generateAuthenticationOptions} (session).
   * @throws AuthenticationError (401) — credential inconnu ou vérification échouée.
   */
  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    requestOrigin?: string,
  ): Promise<IWebAuthnAssertionResult> {
    this.#ensureReady();
    const lib = await this.#ensureLib();
    const pk = this.#config!.passkeys;
    const stored = await this.#store!.findById(response.id);
    if (!stored) {
      throw new AuthenticationError("WebAuthn authentication failed");
    }
    let verification: Awaited<
      ReturnType<typeof lib.verifyAuthenticationResponse>
    >;
    try {
      verification = await lib.verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.#expectedOrigin(requestOrigin),
        expectedRPID: this.#rpID,
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
          counter: stored.signCount,
          transports: stored.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: pk.userVerification === "required",
      });
    } catch {
      throw new AuthenticationError("WebAuthn authentication failed");
    }
    if (!verification.verified) {
      throw new AuthenticationError("WebAuthn authentication failed");
    }
    const info = verification.authenticationInfo;
    await this.#store!.update(stored.id, {
      signCount: info.newCounter,
      backupState: info.credentialBackedUp,
      uvInitialized: stored.uvInitialized || info.userVerified,
      lastUsedAt: Date.now(),
    });
    return { credential: stored, userId: stored.userId };
  }

  /** Liste les credentials d'un utilisateur (UX « mes appareils »). */
  listUserCredentials(userId: string): Promise<IWebAuthnCredential[]> {
    this.#ensureReady();
    return this.#store!.findByUser(userId);
  }

  /**
   * Page de passkeys pour le data plane admin (vue TRANSVERSE : « quels appareils
   * portent des passkeys sur toute la plateforme »).
   *
   * ≠ {@link listUserCredentials}, qui sert la fiche d'UN utilisateur et le chemin
   * chaud du login. Ici on ne matérialise jamais plus d'une page, et la projection
   * du store exclut la clé publique.
   */
  listCredentialsPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>> {
    this.#ensureReady();
    return this.#store!.listPage(query);
  }

  /**
   * Nombre de passkeys correspondant aux filtres, ou `-1` si le backend ne sait
   * pas compter à coût raisonnable (Redis).
   */
  countCredentials(query: IWebAuthnListQuery): Promise<number> {
    this.#ensureReady();
    return this.#store!.countCredentials(query);
  }

  /** Révoque un credential (retrait d'un appareil). */
  removeCredential(credentialId: string): Promise<void> {
    this.#ensureReady();
    return this.#store!.delete(credentialId);
  }

  /**
   * Supprime un credential **du propriétaire** (self-service, anti-IDOR) : la
   * suppression n'aboutit que si le credential appartient bien à `userId`, sinon
   * `false` — 404 indiscernable côté client (on ne révèle pas l'existence d'un
   * credential d'autrui).
   */
  async removeUserCredential(
    userId: string,
    credentialId: string,
  ): Promise<boolean> {
    this.#ensureReady();
    const cred = await this.#store!.findById(credentialId);
    if (!cred || cred.userId !== userId) {
      return false;
    }
    await this.#store!.delete(credentialId);
    return true;
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  /**
   * Origine(s) attendue(s) (anti-phishing, §7.1/§7.2). Liste blanche de config en
   * priorité (prod). À défaut : l'origine de la requête est acceptée **seulement
   * si son hostname == rpID** (dev : `localhost:port` quel que soit le port, sans
   * jamais ouvrir à un domaine tiers). Dernier recours : `https://{rpID}`.
   */
  #expectedOrigin(requestOrigin?: string): string | string[] {
    const origins = this.#config!.passkeys.origins;
    if (origins.length > 0) {
      return [...origins];
    }
    if (requestOrigin) {
      try {
        if (new URL(requestOrigin).hostname === this.#rpID) {
          return requestOrigin;
        }
      } catch {
        /* origine malformée → ignorée */
      }
    }
    return `https://${this.#rpID}`;
  }

  async #ensureLib(): Promise<Lib> {
    return (this.#lib ??= (await import("@simplewebauthn/server")) as Lib);
  }

  #ensureReady(): void {
    if (!this.#ready || !this.#store || !this.#config) {
      throw new Error(
        "WebAuthnService: non initialisé (passkeys désactivés ou boot échoué)",
      );
    }
  }
}

export default WebAuthnService;
export { WebAuthnService };
