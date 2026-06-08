/* eslint-disable @typescript-eslint/no-explicit-any */
// node-forge n'est importé QUE pour ses TYPES (effacés à la compilation). Le
// module runtime est chargé paresseusement (voir `loadForge`) — il n'est JAMAIS
// chargé en production avec un certificat fourni (`explicit`).
import type pkg from "node-forge";
import { Service, Module, Container, Event, extend } from "nodefony";
import fs from "node:fs/promises";
import path, { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Type-valeur du backend node-forge runtime (objet `.pki`/`.md`). L'import type
 * `pkg` sert pour les namespaces de types (`pkg.pki.Certificate`) ; `ForgeModule`
 * pour la valeur chargée dynamiquement (node-forge est un module `export =`).
 */
type ForgeModule = typeof import("node-forge");

/**
 * Vrai si `host` est une IP littérale (IPv4 `n.n.n.n` ou IPv6 — contient `:`).
 * Une IP doit aller en SAN `iPAddress`, jamais en `dNSName` (RFC 6125).
 */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** Algorithmes de hachage de signature autorisés (SHA-1 banni). */
export type CertHash = "sha256" | "sha384" | "sha512";

/** Stratégie de fourniture du certificat exposée en configuration. */
export type CertStrategyConfig = "auto" | "mkcert" | "selfsigned" | "explicit";

/** Stratégie effective résolue au boot (`auto` est résolu vers l'une d'elles). */
type CertStrategy = "explicit" | "mkcert" | "selfsigned";

export interface OpensslOptions {
  /** Taille de la clé RSA (bits). */
  size: number;
  /** Algorithme de hachage de la signature (jamais SHA-1). */
  hash: CertHash;
  /** Durée de validité du certificat (jours). */
  validityDays: number;
  /** Recul de `notBefore` (minutes) — tolérance au décalage d'horloge client. */
  backdateMinutes: number;
  /** Attributs du sujet/issuer (commonName, organizationName…). */
  attrs: pkg.pki.CertificateField[];
}

/** Options de génération du certificat TLS en mode développement. */
export interface CertificateDevOptions {
  /**
   * Préférer `mkcert` (CA locale ajoutée au trust store système) pour générer
   * le certificat de dev. Donne un HTTPS sans erreur navigateur — indispensable
   * pour les sous-ressources cross-origin (Vite) et le WSS du HMR.
   * Si `mkcert` est absent, on retombe sur un auto-signé node-forge (non trusté).
   * Ignoré hors `development`.
   */
  useMkcert: boolean;
}

/** Subject Alternative Name explicite (sinon dérivé du kernel). */
export interface CertificateSanOptions {
  /** Noms DNS (RFC 5280 §4.2.1.6) — font foi pour la vérification d'hôte. */
  dns: string[];
  /** Adresses IP. */
  ip: string[];
}

export interface CertificateOptions {
  /**
   * Comment fournir le certificat. `auto` (défaut) résout mkcert (dev) →
   * auto-signé ; `explicit` charge `key`/`cert` fournis (prod). La génération
   * est un confort de DÉVELOPPEMENT — en production, fournir un vrai certificat
   * (Let's Encrypt, ingress, reverse-proxy) : Nodefony n'est pas une CA.
   */
  strategy?: CertStrategyConfig;
  openssl: OpensslOptions;
  dev: CertificateDevOptions;
  san?: CertificateSanOptions;
  /** Permissions POSIX de la clé privée écrite (0600 = owner-only). */
  privateKeyMode?: number;
  path?: string;
  keyPath?: string;
  certPath?: string;
  caPath?: string;
  key?: string | Buffer;
  cert?: string | Buffer;
  ca?: string | Buffer;
}

interface filesCertType {
  path: string;
  variable: string | Buffer | null;
}

/** Entrée subjectAltName node-forge — type 2 = DNS, type 7 = IP. */
interface AltName {
  type: number;
  value?: string;
  ip?: string;
}

/** Résumé introspectable du certificat serveur (CLI + futur endpoint Studio). */
export interface CertificateInfo {
  /** Stratégie effective ayant fourni le certificat. */
  strategy: CertStrategyConfig;
  certPath: string;
  keyPath: string;
  fullchainPath: string;
  /** Ancre de confiance à passer au client (`--cacert`/`ca`) — si présente. */
  caPath?: string;
  /** Renseignés si un certificat est présent (parsé). */
  commonName?: string;
  san?: string[];
  validFrom?: string;
  validTo?: string;
  signatureAlgorithm?: string;
  serial?: string;
}

const defaultOptions: CertificateOptions = {
  path: resolve(".", "nodefony", "config", "certificates"),
  strategy: "auto",
  privateKeyMode: 0o600,
  dev: {
    useMkcert: true,
  },
  san: { dns: [], ip: [] },
  openssl: {
    size: 2048,
    hash: "sha256",
    validityDays: 365,
    backdateMinutes: 5,
    attrs: [],
  },
};

/**
 * Service de fourniture du certificat TLS du serveur HTTPS/WSS.
 *
 * Trois stratégies : `explicit` (certificat fourni en config — le cas de
 * PRODUCTION), `mkcert` (CA locale trustée, confort de dev) et `selfsigned`
 * (auto-signé node-forge, secours). La génération est réservée au
 * DÉVELOPPEMENT : en production sans certificat fourni, le service crie un
 * avertissement (Nodefony n'est pas une autorité de certification).
 *
 * Conformité (génération auto-signée) : signature SHA-256 (jamais SHA-1,
 * RFC 5280 / CA-B Forum), numéro de série aléatoire 128 bits unique
 * (RFC 5280 §4.1.2.2), SAN qui fait foi (RFC 6125), `notBefore` reculé,
 * clé privée écrite en `0600`.
 */
class Certificate extends Service {
  module: Module;
  files: filesCertType[] = [];
  keysPair: pkg.pki.rsa.KeyPair | null = null;
  certForge: pkg.pki.Certificate | null = null;
  ca: Buffer | string | null = "";
  key: Buffer | string | null = "";
  cert: Buffer | string | null = "";
  fullchainPem: Buffer | string | null = "";
  publicKeyPem: Buffer | string | null = "";
  rootCertPem: Buffer | string | null = "";
  intermediateCertPem: Buffer | string | null = "";

  /** CAROOT résolu de mkcert (null tant que non détecté / indisponible). */
  private mkcertCaRoot: string | null = null;

  /**
   * Backend crypto node-forge, chargé PARESSEUSEMENT. La génération de
   * certificat est un confort de DÉVELOPPEMENT : en production avec un
   * certificat fourni (`strategy: "explicit"`), cette grosse dépendance n'est
   * jamais importée (règle perf-mémoire — pas de dep chargée « au cas où »).
   */
  private forge: ForgeModule | null = null;

  path: string = resolve(".", "nodefony", "config", "certificates");
  serverPath: string = resolve(this.path, "server");
  caPath: string = resolve(this.path, "ca", "nodefony-root-ca.crt.pem");
  publicKeyPath: string = resolve(this.path, "server", "publickey.pem");
  privateKeyPath: string = resolve(this.path, "server", "privkey.pem");
  certPath: string = resolve(this.path, "server", "cert.pem");
  fullchainPath: string = resolve(this.path, "server", "fullchain.pem");
  constructor(module: Module) {
    super(
      "certificates",
      module.container as Container,
      module.notificationsCenter as Event,
      // Cible `{}` (PAS `defaultOptions`) : `extend` mute sa cible — écrire dans
      // `defaultOptions` polluerait la constante partagée entre instances.
      extend(
        true,
        {},
        defaultOptions,
        module.options.certificates || {},
      ) as CertificateOptions,
    );
    this.module = module;
  }

  /** Accès typé aux options du service (Service.options est volontairement lâche). */
  private get certOptions(): CertificateOptions {
    return this.options as unknown as CertificateOptions;
  }

  /** Vrai en environnement de développement (mkcert réservé à ce mode). */
  private isDev(): boolean {
    return this.kernel?.environment === "development";
  }

  /**
   * Charge node-forge à la demande (idempotent) — uniquement sur le chemin de
   * GÉNÉRATION (selfsigned / mkcert / inspection). Le chemin `explicit` (prod)
   * ne l'appelle jamais.
   */
  async loadForge(): Promise<ForgeModule> {
    if (!this.forge) {
      // node-forge = module `export =` → la valeur est sous `.default`.
      this.forge = (await import("node-forge"))
        .default as unknown as ForgeModule;
    }
    return this.forge;
  }

  /** Accès au backend forge déjà chargé (lève si `loadForge` n'a pas été appelé). */
  private get forgeLib(): ForgeModule {
    if (!this.forge) {
      throw new Error(
        "node-forge non chargé — appeler loadForge() avant toute génération.",
      );
    }
    return this.forge;
  }

  async init(): Promise<this> {
    this.kernel?.once("onBoot", async () => {
      this.options = extend(
        true,
        this.options,
        this.module.options.certificates || {},
      ) as CertificateOptions;
      await this.generateServerCertificates();
    });
    return this;
  }

  /**
   * Numéro de série X.509 — RFC 5280 §4.1.2.2 : entier positif unique par CA.
   * 128 bits aléatoires (≥ 64 bits d'entropie exigés par le CA/Browser Forum
   * contre les attaques par collision) ; bit de poids fort à 0 pour garantir un
   * entier positif en encodage DER ; ≤ 20 octets.
   */
  private static generateSerialHex(): string {
    const bytes = randomBytes(16);
    bytes[0] &= 0x7f; // entier positif (DER)
    if (bytes[0] === 0) {
      bytes[0] = 0x01; // jamais d'octet de tête nul
    }
    return bytes.toString("hex");
  }

  setFiles(): void {
    this.files = [
      { path: this.privateKeyPath, variable: this.key },
      { path: this.publicKeyPath, variable: this.publicKeyPem },
      { path: this.certPath, variable: this.cert },
      { path: this.fullchainPath, variable: this.fullchainPem },
    ];
  }

  private async checkCertificates(): Promise<boolean> {
    try {
      await Promise.all(this.files.map((file) => fs.access(file.path)));
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDirectoriesExist(): Promise<void> {
    // On ne crée QUE ce qu'on écrit : server/ (clé+cert) et ca/ (ancre de
    // confiance). Les dossiers client/ et ca_intermediate/ relèvent de la PKI
    // complète (bin/generateCertificates.sh) — ne pas créer de dossiers vides.
    const directories = [
      this.path,
      this.serverPath,
      path.dirname(this.privateKeyPath),
      path.dirname(this.caPath),
      path.dirname(this.certPath),
      path.dirname(this.fullchainPath),
    ];

    for await (const directory of directories) {
      try {
        await fs.access(directory);
      } catch {
        // Directory does not exist, create it
        await fs.mkdir(directory, { recursive: true });
        this.log(`Directory created: ${directory}`, "DEBUG");
      }
    }
  }

  /**
   * Génère (ou recharge) le certificat serveur selon la stratégie résolue :
   * `explicit` (fourni en config / prod), `mkcert` (dev, CA trustée) ou
   * `selfsigned` (auto-signé node-forge, secours). Régénère automatiquement si
   * le certificat présent sur disque n'est pas adéquat pour la stratégie active
   * (expiré, SHA-1, SAN incomplet).
   *
   * @param force - forcer la régénération même si un certificat valide existe
   */
  async generateServerCertificates(force: boolean = false): Promise<this> {
    // Auto-suffisant : peuple `this.files` quel que soit l'appelant (hook onBoot
    // du service OU commande CLI) → `checkCertificates`/`readCerticates` opèrent
    // sur la vraie liste (sinon liste vide = faux positif + cert non relu).
    this.setFiles();
    await this.ensureDirectoriesExist();
    const strategy = await this.resolveStrategy();

    // Prod / config : certificat fourni explicitement — chargé tel quel,
    // SANS node-forge (la grosse dépendance reste hors du process en prod).
    if (strategy === "explicit") {
      return this.loadExplicitCert();
    }

    // À partir d'ici on GÉNÈRE (dev) → on charge node-forge paresseusement.
    await this.loadForge();

    const anyFileExists = await this.checkCertificates();
    if (anyFileExists && !force && (await this.isCertAdequate(strategy))) {
      return this.readCerticates();
    }

    if (strategy === "mkcert") {
      await this.generateWithMkcert();
    } else {
      this.keysPair = this.generateKeys();
      this.certForge = this.createCertificate();
      this.setExtension();
      this.sign();
      this.key = this.generatePrivateKeyPem();
      this.publicKeyPem = this.generatePublickeyPem();
      const certPem = this.generateCertPem();
      this.cert = certPem;
      // Auto-signé = sa propre ancre de confiance (pin). On l'écrit dans `ca/`
      // comme le fait mkcert → un script peut faire une requête VÉRIFIÉE
      // (`curl --cacert`, `NODE_EXTRA_CA_CERTS`) sans désactiver le contrôle TLS.
      this.ca = certPem;
      this.fullchainPem = this.createFullChain();
      this.setFiles();
      // Régénération : on écrase l'ancien matériel (force interne).
      await this.writeCertificates(true);
      await fs.writeFile(this.caPath, certPem.toString(), "utf8");
    }
    return this.readCerticates();
  }

  /**
   * Résout la stratégie effective à partir de `certificates.strategy` :
   * - `explicit` : `key` + `cert` fournis (prod, Let's Encrypt…). Forcé →
   *   erreur si absents.
   * - `mkcert` : dev + binaire mkcert + CA locale présents. Forcé hors dev →
   *   retombe sur `selfsigned` avec avertissement.
   * - `selfsigned` : auto-signé node-forge (fallback). En PRODUCTION, crie un
   *   avertissement : la génération n'est pas le rôle d'un serveur de prod.
   */
  private async resolveStrategy(): Promise<CertStrategy> {
    const requested = this.certOptions.strategy ?? "auto";

    if (requested === "explicit") {
      if (!this.hasExplicitCert()) {
        throw new Error(
          "certificates.strategy='explicit' mais key/cert absents de la configuration.",
        );
      }
      return "explicit";
    }
    if (requested === "auto" && this.hasExplicitCert()) {
      return "explicit";
    }

    if (requested === "mkcert" || requested === "auto") {
      if (this.isDev() && this.certOptions.dev?.useMkcert !== false) {
        const caRoot = await this.detectMkcert();
        if (caRoot) {
          this.mkcertCaRoot = caRoot;
          return "mkcert";
        }
        this.log(
          (requested === "mkcert"
            ? "strategy='mkcert' mais mkcert introuvable — "
            : "mkcert introuvable — ") +
            "fallback certificat auto-signé node-forge (non trusté). " +
            "`brew install mkcert nss && mkcert -install` pour un HTTPS dev sans erreur (HMR cross-origin/WSS).",
          "WARNING",
        );
      } else if (requested === "mkcert") {
        this.log(
          "strategy='mkcert' ignoré hors development → certificat auto-signé.",
          "WARNING",
        );
      }
    }

    // selfsigned : en PROD, ce n'est PAS le rôle de Nodefony d'émettre un cert.
    if (!this.isDev()) {
      this.log(
        "Aucun certificat TLS fourni en PRODUCTION : génération d'un auto-signé " +
          "NON trusté (secours). Nodefony n'est PAS une autorité de certification " +
          "de production — fournissez un vrai certificat (Let's Encrypt, ingress " +
          "k8s, reverse-proxy edge) via certificates.{ key, cert, ca } " +
          "(strategy='explicit').",
        "WARNING",
      );
    }
    return "selfsigned";
  }

  /** `key` + `cert` présents en config (chemin fichier ou Buffer) → cert fourni. */
  private hasExplicitCert(): boolean {
    const o = this.certOptions;
    return Boolean(o.key) && Boolean(o.cert);
  }

  /**
   * Détecte mkcert : binaire dans le PATH + CA racine générée (rootCA.pem).
   * @returns le chemin CAROOT, ou null si indisponible.
   */
  private async detectMkcert(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("mkcert", ["-CAROOT"]);
      const caRoot = stdout.trim();
      if (!caRoot) {
        return null;
      }
      await fs.access(path.join(caRoot, "rootCA.pem"));
      return caRoot;
    } catch {
      return null;
    }
  }

  /**
   * SAN effectif : config explicite si fournie, sinon dérivé du kernel
   * (localhost + domain en DNS ; loopback en IP). Une IP littérale (ex. domain
   * `127.0.0.1` en dev) est classée en `ip`, pas en `dns` (RFC 6125).
   */
  private derivedSan(): CertificateSanOptions {
    const san = this.certOptions.san;
    if (san && (san.dns.length > 0 || san.ip.length > 0)) {
      return san;
    }
    const dns = ["localhost"];
    const ip = ["127.0.0.1", "::1"];
    const domain = this.kernel?.domain;
    // `0.0.0.0` = bind toutes interfaces, PAS un nom d'hôte → jamais en SAN.
    if (domain && domain !== "localhost" && domain !== "0.0.0.0") {
      if (isIpLiteral(domain)) {
        if (!ip.includes(domain)) {
          ip.unshift(domain);
        }
      } else {
        dns.unshift(domain);
      }
    }
    return { dns, ip };
  }

  /** Hostnames DNS couverts par le SAN. */
  private sanDnsNames(): string[] {
    return this.derivedSan().dns;
  }

  /** Adresses IP couvertes par le SAN. */
  private sanIps(): string[] {
    return this.derivedSan().ip;
  }

  /** Hostnames passés à mkcert (DNS + IP du SAN). */
  private certHostnames(): string[] {
    return [...this.sanDnsNames(), ...this.sanIps()];
  }

  /**
   * Génère le certificat de dev via mkcert (signé par la CA locale trustée).
   * Écrit cert + clé privée (mkcert), puis dérive clé publique, fullchain et CA.
   */
  private async generateWithMkcert(): Promise<void> {
    const caRoot = this.mkcertCaRoot ?? (await this.detectMkcert());
    if (!caRoot) {
      throw new Error("mkcert CAROOT introuvable");
    }
    const names = this.certHostnames();
    await execFileAsync("mkcert", [
      "-cert-file",
      this.certPath,
      "-key-file",
      this.privateKeyPath,
      ...names,
    ]);
    await this.restrictPrivateKey();
    const rootCaPem = await fs.readFile(
      path.join(caRoot, "rootCA.pem"),
      "utf8",
    );
    const certPem = await fs.readFile(this.certPath, "utf8");
    const { pki } = this.forgeLib;
    // Clé publique dérivée du certificat (mkcert ne l'émet pas séparément).
    const publicKeyPem = pki.publicKeyToPem(
      pki.certificateFromPem(certPem).publicKey,
    );
    await fs.writeFile(this.publicKeyPath, publicKeyPem, "utf8");
    await fs.writeFile(this.fullchainPath, `${certPem}${rootCaPem}`, "utf8");
    await fs.writeFile(this.caPath, rootCaPem, "utf8");
    this.log(
      `Certificat dev généré via mkcert (CA trustée) — ${names.join(", ")}`,
      "INFO",
    );
  }

  /**
   * Vérifie que le certificat présent sur disque convient à la stratégie :
   * - expiration (RFC 5280 §4.1.2.5) : un cert expiré est inadéquat.
   * - **SAN** couvrant les hostnames requis (les DEUX stratégies) : si le SAN
   *   demandé change (ex. `nodefony.com` ajouté via NF_BIND_ALL), on régénère.
   * - `mkcert` : émis par la CA mkcert (issuer organisation contient "mkcert").
   * - `selfsigned` : signature non SHA-1.
   * @returns false si absent, illisible ou inadéquat → déclenche la régénération.
   */
  private async isCertAdequate(strategy: CertStrategy): Promise<boolean> {
    try {
      const { pki } = this.forgeLib;
      const certPem = await fs.readFile(this.certPath, "utf8");
      const cert = pki.certificateFromPem(certPem);
      if (cert.validity.notAfter.getTime() <= Date.now()) {
        return false;
      }
      // Le SAN doit couvrir les noms requis QUELLE QUE SOIT la stratégie — sinon
      // un changement de SAN (NF_BIND_ALL → nodefony.com) ne régénérerait jamais.
      const ext = cert.getExtension("subjectAltName") as
        | { altNames?: AltName[] }
        | undefined;
      if (!ext || !this.sanCovers(ext.altNames ?? [])) {
        return false;
      }
      if (strategy === "mkcert") {
        const org = cert.issuer.getField("O");
        return Boolean(org && /mkcert/i.test(String(org.value)));
      }
      // selfsigned : un ancien cert SHA-1 doit être régénéré.
      return cert.signatureOid !== pki.oids.sha1WithRSAEncryption;
    } catch {
      return false;
    }
  }

  /** Le SAN présent couvre-t-il tous les noms DNS requis (RFC 6125) ? */
  private sanCovers(present: AltName[]): boolean {
    const presentDns = new Set(
      present
        .filter((p) => p.type === 2 && p.value)
        .map((p) => p.value as string),
    );
    return this.sanDnsNames().every((name) => presentDns.has(name));
  }

  /** Charge un certificat fourni en config (chemin fichier ou Buffer). */
  private async loadExplicitCert(): Promise<this> {
    const o = this.certOptions;
    this.key = await this.resolveMaterial(o.key);
    this.cert = await this.resolveMaterial(o.cert);
    this.fullchainPem = this.cert;
    if (o.ca) {
      this.ca = await this.resolveMaterial(o.ca);
    }
    this.setFiles();
    this.log("Certificat TLS chargé depuis la configuration (fourni).", "INFO");
    return this;
  }

  /** Résout un matériel TLS : Buffer renvoyé tel quel, string lue comme chemin. */
  private async resolveMaterial(
    value: string | Buffer | undefined,
  ): Promise<Buffer> {
    if (!value) {
      throw new Error("certificate material is empty");
    }
    if (Buffer.isBuffer(value)) {
      return value;
    }
    return Buffer.from(await fs.readFile(value, "utf8"));
  }

  createFullChain(): string {
    return [this.cert, this.intermediateCertPem, this.rootCertPem]
      .map((part) => part?.toString().trim())
      .filter(Boolean)
      .join("\n");
  }

  async readCerticates(): Promise<this> {
    for (const file of this.files) {
      try {
        await fs.access(file.path);
        const buf = Buffer.from(await fs.readFile(file.path, "utf8"));
        if (file.path === this.privateKeyPath) {
          this.key = buf;
        } else if (file.path === this.publicKeyPath) {
          this.publicKeyPem = buf;
        } else if (file.path === this.caPath) {
          this.ca = buf;
        } else if (file.path === this.certPath) {
          this.cert = buf;
        } else if (file.path === this.fullchainPath) {
          this.fullchainPem = buf;
        }
        this.log(`Read Certificat file ${file.path}`, "DEBUG");
      } catch (err) {
        this.log(err as Error, "WARNING");
      }
    }
    // Ancre CA (hors `this.files` pour ne pas la réécrire à chaque write) — sert
    // l'option `ca` du serveur ET le chemin de confiance des clients.
    try {
      await fs.access(this.caPath);
      this.ca = Buffer.from(await fs.readFile(this.caPath, "utf8"));
    } catch {
      // Pas d'ancre CA séparée (ex. cert explicite sans CA fournie) — OK.
    }
    return this;
  }

  async writeCertificates(force: boolean = false): Promise<this> {
    await this.ensureDirectoriesExist();
    for await (const file of this.files) {
      try {
        if (file.variable) {
          const fileExists = await fs
            .access(file.path)
            .then(() => true)
            .catch(() => false);
          if (!force && fileExists) {
            this.log(`File ${file.path} already exists, skipping.`, "DEBUG");
            continue; // Skip writing if force is false and file exists
          }
          if (force && fileExists) {
            await fs.unlink(file.path); // Delete existing file if force is true and file exists
            this.log(`Existing file ${file.path} deleted.`, "DEBUG");
          }
          const isPrivateKey = file.path === this.privateKeyPath;
          await fs.writeFile(file.path, file.variable.toString(), {
            encoding: "utf8",
            // Clé privée : jamais world-readable (0600 par défaut).
            mode: isPrivateKey
              ? (this.certOptions.privateKeyMode ?? 0o600)
              : 0o644,
          });
          this.log(
            `Certificate file ${file.path} written successfully.`,
            "INFO",
          );
        }
      } catch (err) {
        this.log(`Error writing to file ${file.path}`, "ERROR");
        this.log(err, "ERROR");
        throw err;
      }
    }
    await this.restrictPrivateKey();
    return this;
  }

  /**
   * Durcit les permissions de la clé privée (et de son dossier) après écriture
   * — garantit `0600` même si l'umask du process était permissif (la clé écrite
   * par mkcert passe aussi par ici). Échec silencieux hors POSIX.
   */
  private async restrictPrivateKey(): Promise<void> {
    const mode = this.certOptions.privateKeyMode ?? 0o600;
    try {
      await fs.chmod(this.privateKeyPath, mode);
      await fs.chmod(this.serverPath, 0o700);
    } catch (err) {
      this.log(err as Error, "DEBUG");
    }
  }

  generateKeys(): pkg.pki.rsa.KeyPair {
    // Générer une paire de clés
    return this.forgeLib.pki.rsa.generateKeyPair(this.certOptions.openssl.size);
  }
  generatePrivateKeyPem(): Buffer {
    if (this.keysPair) {
      return Buffer.from(
        this.forgeLib.pki.privateKeyToPem(this.keysPair.privateKey),
      );
    }
    throw new Error(`pki.rsa.KeyPair  not found`);
  }
  generatePublickeyPem(): Buffer {
    if (this.keysPair)
      return Buffer.from(
        this.forgeLib.pki.publicKeyToPem(this.keysPair.publicKey),
      );
    throw new Error(`pki.rsa.KeyPair  not found`);
  }
  generateCertPem(): Buffer {
    if (this.certForge) {
      return Buffer.from(this.forgeLib.pki.certificateToPem(this.certForge));
    }
    throw new Error(`pki.Certificate  not found`);
  }

  createCertificate(): pkg.pki.Certificate {
    if (!this.keysPair) {
      throw new Error(`KeyPair  not found`);
    }
    const o = this.certOptions.openssl;
    const cert = this.forgeLib.pki.createCertificate();
    cert.publicKey = this.keysPair.publicKey;
    // Série aléatoire unique (RFC 5280 §4.1.2.2) — plus de série fixe.
    cert.serialNumber = Certificate.generateSerialHex();
    // notBefore reculé : tolère le décalage d'horloge du client (clock skew).
    const backdateMs = o.backdateMinutes * 60_000;
    const start = Date.now() - backdateMs;
    cert.validity.notBefore = new Date(start);
    cert.validity.notAfter = new Date(start + o.validityDays * 86_400_000);
    cert.setSubject(o.attrs);
    cert.setIssuer(o.attrs);
    return cert;
  }

  /** subjectAltName de l'auto-signé : DNS + IP (config explicite sinon dérivé). */
  private altNames(): AltName[] {
    const out: AltName[] = [];
    for (const dns of this.sanDnsNames()) {
      out.push({ type: 2, value: dns });
    }
    for (const ip of this.sanIps()) {
      out.push({ type: 7, ip });
    }
    return out;
  }

  setExtension(): void {
    if (!this.certForge) {
      throw new Error(`pki.Certificate  not found`);
    }
    this.certForge.setExtensions([
      {
        // Certificat serveur feuille, PAS une autorité de certification.
        name: "basicConstraints",
        cA: false,
      },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        // Indispensable pour l'usage TLS serveur côté navigateurs récents.
        name: "extKeyUsage",
        serverAuth: true,
        clientAuth: true,
      },
      {
        // SAN requis : Chrome ignore le commonName depuis RFC 2818.
        name: "subjectAltName",
        altNames: this.altNames(),
      },
      {
        // RFC 5280 §4.2.1.2 — dérivé de la clé publique par node-forge.
        // (AKI §4.2.1.1 omis : facultatif pour un certificat auto-signé.)
        name: "subjectKeyIdentifier",
      },
    ]);
  }

  /**
   * Signe le certificat avec le hachage configuré (SHA-256 par défaut).
   * SHA-1 est INTERDIT (collision SHAttered 2017, CA/Browser Forum depuis 2016) :
   * `node-forge` signe en SHA-1 par défaut si on ne passe pas de digest → on en
   * passe toujours un.
   */
  sign(): void {
    if (!this.certForge || !this.keysPair) {
      throw new Error(`pki.rsa.KeyPair or pki.Certificate  not found`);
    }
    this.certForge.sign(
      this.keysPair.privateKey,
      this.digestFor(this.certOptions.openssl.hash),
    );
  }

  /**
   * Résumé introspectable du certificat serveur courant — réutilisé par la
   * commande CLI `certificates` et un futur endpoint d'admin Studio (parité
   * CLI ↔ Web). Parse le certificat chargé (charge node-forge à la demande).
   */
  async describe(): Promise<CertificateInfo> {
    const info: CertificateInfo = {
      strategy: this.certOptions.strategy ?? "auto",
      certPath: this.certPath,
      keyPath: this.privateKeyPath,
      fullchainPath: this.fullchainPath,
    };
    try {
      await fs.access(this.caPath);
      info.caPath = this.caPath;
    } catch {
      // Pas d'ancre CA (ex. mkcert avec CA dans le trust store système).
    }
    if (!this.cert) {
      return info;
    }
    const { pki } = await this.loadForge();
    try {
      const cert = pki.certificateFromPem(this.cert.toString());
      info.serial = cert.serialNumber;
      info.validFrom = cert.validity.notBefore.toISOString();
      info.validTo = cert.validity.notAfter.toISOString();
      info.signatureAlgorithm = this.oidName(cert.signatureOid, pki);
      const cn = cert.subject.getField("CN");
      if (cn) {
        info.commonName = String(cn.value);
      }
      const ext = cert.getExtension("subjectAltName") as
        | { altNames?: AltName[] }
        | undefined;
      if (ext?.altNames) {
        info.san = ext.altNames.map((a) =>
          a.type === 7 ? (a.ip ?? "") : (a.value ?? ""),
        );
      }
    } catch {
      // Certificat illisible (fourni externe au format inattendu) → résumé partiel.
    }
    return info;
  }

  /** Nom lisible de l'OID d'algorithme de signature. */
  private oidName(oid: string, pki: ForgeModule["pki"]): string {
    return (pki.oids as Record<string, string>)[oid] ?? oid;
  }

  /** Digest node-forge correspondant au hachage configuré (jamais SHA-1). */
  private digestFor(hash: CertHash): pkg.md.MessageDigest {
    const { md } = this.forgeLib;
    switch (hash) {
      case "sha512":
        return md.sha512.create();
      case "sha384":
        return md.sha384.create();
      case "sha256":
        return md.sha256.create();
      default:
        this.log(
          `Hachage '${hash}' refusé (SHA-1 interdit) → SHA-256.`,
          "WARNING",
        );
        return md.sha256.create();
    }
  }
}

export default Certificate;
