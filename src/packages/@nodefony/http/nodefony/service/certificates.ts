import { Service, Module, Container, extend } from "nodefony";
import fs from "node:fs/promises";
import path, { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import tls from "node:tls";
import {
  generateKeyPair,
  randomBytes,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { asServersConfig } from "../src/servers/kernelServers";
import {
  createSelfSignedCertificate,
  distinguishedNameField,
  parseSubjectAltName,
  SHA1_WITH_RSA_OID,
  signatureAlgorithmName,
  signatureAlgorithmOid,
  type ICertificateAttribute,
} from "./x509";

const execFileAsync = promisify(execFile);
const generateKeyPairAsync = promisify(generateKeyPair);

/**
 * Accès à la liste d'ancres TLS par défaut du processus — injectable pour
 * éprouver la décision sans toucher la confiance du processus de test.
 */
export interface ITlsTrustStore {
  getCACertificates?: (type?: "default") => string[];
  setDefaultCACertificates?: (certs: ReadonlyArray<string>) => void;
}

/** Issue de {@link addDefaultCaCertificate}, CONSTATÉE à l'exécution. */
export type CaTrustVerdict = "added" | "present" | "unsupported";

/** Compare deux PEM sans dépendre des fins de ligne ni des espaces. */
function normalizePem(pem: string): string {
  return pem.replace(/\s+/g, "");
}

/**
 * Ajoute une autorité aux ancres TLS par défaut du processus (requêtes sortantes
 * `fetch`, `https`, `tls.connect`), sans en retirer aucune.
 *
 * C'est l'équivalent en cours d'exécution de `NODE_EXTRA_CA_CERTS`, qui n'est lu
 * qu'au lancement du processus — trop tôt pour une CA que le boot vient de
 * générer, et que seul un script de banc posait. La capacité se CONSTATE
 * (`tls.setDefaultCACertificates` n'existe qu'à partir de Node 24.5), elle ne se
 * déduit pas d'un numéro de version. Idempotent : une autorité déjà présente
 * n'est pas ajoutée deux fois.
 *
 * @param pem - autorité au format PEM.
 * @param store - accès aux ancres ; `node:tls` par défaut.
 * @returns `added`, `present` (déjà de confiance), ou `unsupported`.
 */
export function addDefaultCaCertificate(
  pem: string,
  store: ITlsTrustStore = tls,
): CaTrustVerdict {
  const { getCACertificates, setDefaultCACertificates } = store;
  if (
    typeof getCACertificates !== "function" ||
    typeof setDefaultCACertificates !== "function"
  ) {
    return "unsupported";
  }
  const current = getCACertificates("default");
  const wanted = normalizePem(pem);
  if (current.some((c) => normalizePem(c) === wanted)) {
    return "present";
  }
  setDefaultCACertificates([...current, pem]);
  return "added";
}

/** Paire de clés RSA du certificat auto-signé. */
export interface IRsaKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/**
 * Vrai si `host` est une IP littérale (IPv4 `n.n.n.n` ou IPv6 — contient `:`).
 * Une IP doit aller en SAN `iPAddress`, jamais en `dNSName` (RFC 9525).
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

/**
 * Options de génération du certificat AUTO-SIGNÉ (`node:crypto` — aucun
 * binaire externe ni aucune dépendance tierce).
 *
 * ⚠️ Portée : ces réglages ne valent QUE pour la stratégie `selfsigned`. Sous
 * `mkcert` (le défaut en développement) ils sont ignorés — mkcert ne reçoit que
 * les noms d'hôtes — et sous `strategy: "explicit"` le certificat est fourni,
 * donc rien n'est généré.
 */
export interface SelfSignedOptions {
  /** Taille de la clé RSA (bits). */
  size: number;
  /** Algorithme de hachage de la signature (jamais SHA-1). */
  hash: CertHash;
  /** Durée de validité du certificat (jours). */
  validityDays: number;
  /** Recul de `notBefore` (minutes) — tolérance au décalage d'horloge client. */
  backdateMinutes: number;
  /** Attributs du sujet/issuer (commonName, organizationName…). */
  attrs: ICertificateAttribute[];
}

/** Options de génération du certificat TLS en mode développement. */
export interface CertificateDevOptions {
  /**
   * Préférer `mkcert` (CA locale ajoutée au trust store système) pour générer
   * le certificat de dev. Donne un HTTPS sans erreur navigateur — indispensable
   * pour les sous-ressources cross-origin (Vite) et le WSS du HMR.
   * Si `mkcert` est absent, on retombe sur un auto-signé (non trusté).
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
  strategy?: CertStrategyConfig | undefined;
  selfSigned: SelfSignedOptions;
  dev: CertificateDevOptions;
  san?: CertificateSanOptions | undefined;
  /** Permissions POSIX de la clé privée écrite (0600 = owner-only). */
  privateKeyMode?: number | undefined;
  path?: string | undefined;
  keyPath?: string | undefined;
  certPath?: string | undefined;
  caPath?: string | undefined;
  key?: string | Buffer | undefined;
  cert?: string | Buffer | undefined;
  ca?: string | Buffer | undefined;
}

interface filesCertType {
  path: string;
  variable: string | Buffer | null;
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
  selfSigned: {
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
 * (auto-signé, secours). La génération est réservée au
 * DÉVELOPPEMENT : en production sans certificat fourni, le service crie un
 * avertissement (Nodefony n'est pas une autorité de certification).
 *
 * Conformité (génération auto-signée) : signature SHA-256 (jamais SHA-1,
 * RFC 5280 / CA-B Forum), numéro de série aléatoire 128 bits unique
 * (RFC 5280 §4.1.2.2), SAN qui fait foi (RFC 9525), `notBefore` reculé,
 * clé privée écrite en `0600`.
 */

class Certificate extends Service {
  module: Module;
  files: filesCertType[] = [];
  keysPair: IRsaKeyPair | null = null;
  ca: Buffer | string | null = "";
  key: Buffer | string | null = "";
  cert: Buffer | string | null = "";
  fullchainPem: Buffer | string | null = "";
  publicKeyPem: Buffer | string | null = "";

  /** CAROOT résolu de mkcert (null tant que non détecté / indisponible). */
  private mkcertCaRoot: string | null = null;

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
      module.notificationsCenter,
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
   * Fabrique-t-on un certificat au démarrage ?
   *
   * 🔴 Seulement si un serveur TLS est ACTIF. Sans cette question, le hook
   * ci-dessous écrit dans `nodefony/config/certificates` à CHAQUE boot — y
   * compris celui d'une application qui a coupé son écoute TLS, et y compris un
   * run de console qui n'ouvre aucun port.
   *
   * Ce qu'il en coûtait, mesuré sur une image générée : le code d'une image
   * appartient à `root` et le processus tourne en `1000` (c'est voulu — une
   * application qui peut réécrire son propre `dist/` offre à une faille un moyen
   * de PERSISTER). Le `mkdir` mourait donc en `EACCES`, le hook de boot était
   * « critique », et l'application ne démarrait PAS — quel que soit son préset.
   * L'erreur nommait un dossier de certificats sur une application qui n'en veut
   * aucun : elle envoyait chercher du côté du TLS un défaut de permission.
   *
   * C'est aussi ce que le gabarit d'application promet en toutes lettres : en
   * production, l'écoute TLS est coupée tant qu'aucun port HTTPS n'est demandé,
   * précisément pour ne PAS fabriquer une clé RSA à chaque démarrage de chaque
   * exemplaire. La promesse était écrite ; rien ne la tenait.
   */
  private get tlsWanted(): boolean {
    return !!asServersConfig(this.module.kernel?.options.servers)?.https;
  }

  async init(): Promise<this> {
    if (!this.tlsWanted) {
      return this;
    }
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
    const head = bytes.readUInt8(0) & 0x7f; // entier positif (DER)
    bytes[0] = head === 0 ? 0x01 : head; // jamais d'octet de tête nul
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

    for (const directory of directories) {
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
   * `selfsigned` (auto-signé, secours). Régénère automatiquement si
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

    // Prod / config : certificat fourni explicitement — chargé tel quel.
    if (strategy === "explicit") {
      return this.loadExplicitCert();
    }

    const anyFileExists = await this.checkCertificates();
    if (anyFileExists && !force && (await this.isCertAdequate(strategy))) {
      await this.readCerticates();
      this.trustDevelopmentAuthority();
      return this;
    }

    if (strategy === "mkcert") {
      await this.generateWithMkcert();
    } else {
      this.keysPair = await this.generateKeys();
      this.key = this.generatePrivateKeyPem();
      this.publicKeyPem = this.generatePublickeyPem();
      const certPem = await this.createCertificate();
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
    await this.readCerticates();
    this.trustDevelopmentAuthority();
    return this;
  }

  /**
   * En développement, fait confiance à la CA que Nodefony vient de générer ou de
   * relire, pour les requêtes SORTANTES du processus.
   *
   * Sans elle, un service du décor qui sert le certificat de l'application
   * (Keycloak, l'auto-vérification d'un jeton MCP) est injoignable depuis
   * `nodefony development` — `fetch failed` / `SELF_SIGNED_CERT_IN_CHAIN` — alors
   * que `curl -k` répond : la confiance n'existait que sous le script de banc.
   * Réservé au DÉVELOPPEMENT et aux certificats que Nodefony fabrique : un
   * certificat `explicit` (production) n'élargit jamais la confiance du processus.
   */
  private trustDevelopmentAuthority(): void {
    if (!this.isDev() || !this.ca || this.ca.length === 0) {
      return;
    }
    const verdict = addDefaultCaCertificate(this.ca.toString());
    if (verdict === "added") {
      this.log(
        `CA de développement ajoutée aux ancres TLS du processus (${this.caPath})`,
        "DEBUG",
      );
    } else if (verdict === "unsupported") {
      this.log(
        "Ce Node ne sait pas élargir ses ancres TLS en cours d'exécution " +
          "(tls.setDefaultCACertificates, Node ≥ 24.5) : les requêtes sortantes " +
          "vers un service qui sert le certificat de développement échoueront. " +
          `Relancer avec NODE_EXTRA_CA_CERTS=${this.caPath}`,
        "WARNING",
      );
    }
  }

  /**
   * Résout la stratégie effective à partir de `certificates.strategy` :
   * - `explicit` : `key` + `cert` fournis (prod, Let's Encrypt…). Forcé →
   *   erreur si absents.
   * - `mkcert` : dev + binaire mkcert + CA locale présents. Forcé hors dev →
   *   retombe sur `selfsigned` avec avertissement.
   * - `selfsigned` : auto-signé (fallback). En PRODUCTION, crie un
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
      // Config lue sur disque : `undefined` doit rester « mkcert autorisé » —
      // la comparaison stricte à `false` est voulue.
      // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
      if (this.isDev() && this.certOptions.dev.useMkcert !== false) {
        const caRoot = await this.detectMkcert();
        if (caRoot) {
          this.mkcertCaRoot = caRoot;
          return "mkcert";
        }
        this.log(
          (requested === "mkcert"
            ? "strategy='mkcert' mais mkcert introuvable — "
            : "mkcert introuvable — ") +
            "fallback certificat auto-signé (non trusté). " +
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
   * `127.0.0.1` en dev) est classée en `ip`, pas en `dns` (RFC 9525).
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
    // Clé publique dérivée du certificat (mkcert ne l'émet pas séparément).
    const publicKeyPem = new X509Certificate(certPem).publicKey.export({
      type: "spki",
      format: "pem",
    });
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
      const cert = new X509Certificate(await fs.readFile(this.certPath));
      if (cert.validToDate.getTime() <= Date.now()) {
        return false;
      }
      // Le SAN doit couvrir les noms requis QUELLE QUE SOIT la stratégie — sinon
      // un changement de SAN (NF_BIND_ALL → nodefony.com) ne régénérerait jamais.
      if (!this.sanCovers(parseSubjectAltName(cert.subjectAltName).dns)) {
        return false;
      }
      if (strategy === "mkcert") {
        const org = distinguishedNameField(cert.issuer, "O");
        return org !== null && /mkcert/i.test(org);
      }
      // selfsigned : un ancien cert SHA-1 doit être régénéré.
      return signatureAlgorithmOid(cert.raw) !== SHA1_WITH_RSA_OID;
    } catch {
      return false;
    }
  }

  /** Le SAN présent couvre-t-il tous les noms DNS requis (RFC 9525) ? */
  private sanCovers(presentDns: string[]): boolean {
    return this.sanDnsNames().every((name) => presentDns.includes(name));
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
    // Seul appelant : la génération autosignée, sans intermédiaire ni racine
    // distincte — la chaîne complète EST le certificat.
    return this.cert?.toString().trim() ?? "";
  }

  async readCerticates(): Promise<this> {
    for (const file of this.files) {
      try {
        // Pas d'`access` avant le `readFile` : il ne protège rien (le fichier
        // peut disparaître entre les deux — TOCTOU) et `readFile` lève déjà
        // ENOENT/EACCES, que le `catch` ci-dessous traite à l'identique. Un
        // appel système de moins par certificat au démarrage.
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
        this.log(err, "WARNING");
      }
    }
    // Ancre CA (hors `this.files` pour ne pas la réécrire à chaque write) — sert
    // l'option `ca` du serveur ET le chemin de confiance des clients.
    try {
      this.ca = Buffer.from(await fs.readFile(this.caPath, "utf8"));
    } catch {
      // Pas d'ancre CA séparée (ex. cert explicite sans CA fournie) — OK.
    }
    return this;
  }

  async writeCertificates(force: boolean = false): Promise<this> {
    await this.ensureDirectoriesExist();
    for (const file of this.files) {
      try {
        if (file.variable) {
          const isPrivateKey = file.path === this.privateKeyPath;
          // Clé privée : jamais world-readable (0600 par défaut).
          const mode = isPrivateKey
            ? (this.certOptions.privateKeyMode ?? 0o600)
            : 0o644;
          if (force) {
            // `rm({force})` ne lève pas sur un fichier absent : plus rien à
            // tester avant de supprimer.
            await fs.rm(file.path, { force: true });
          }
          try {
            // `wx` — le NOYAU tranche « existe / n'existe pas » et crée dans la
            // MÊME opération, là où `access` puis `writeFile` laissait une
            // fenêtre entre le test et l'écriture (TOCTOU).
            // `mode` ne vaut ici que pour la CRÉATION ; la garantie `0600` de la
            // clé privée, elle, est portée par {@link restrictPrivateKey} (chmod
            // explicite après écriture, quel que soit l'umask) — ne pas la
            // croire tenue par cette ligne.
            await fs.writeFile(file.path, file.variable.toString(), {
              encoding: "utf8",
              flag: "wx",
              mode,
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              this.log(`File ${file.path} already exists, skipping.`, "DEBUG");
              continue;
            }
            throw error;
          }
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
      this.log(err, "DEBUG");
    }
  }

  /** Génère la paire RSA (taille configurée) hors de la boucle d'événements. */
  async generateKeys(): Promise<IRsaKeyPair> {
    return generateKeyPairAsync("rsa", {
      modulusLength: this.certOptions.selfSigned.size,
    });
  }

  /** Clé privée en PEM PKCS#1 (`BEGIN RSA PRIVATE KEY`). */
  generatePrivateKeyPem(): Buffer {
    if (this.keysPair) {
      return Buffer.from(
        this.keysPair.privateKey.export({ type: "pkcs1", format: "pem" }),
      );
    }
    throw new Error(`KeyPair not found`);
  }

  /** Clé publique en PEM SPKI (`BEGIN PUBLIC KEY`). */
  generatePublickeyPem(): Buffer {
    if (this.keysPair) {
      return Buffer.from(
        this.keysPair.publicKey.export({ type: "spki", format: "pem" }),
      );
    }
    throw new Error(`KeyPair not found`);
  }

  /**
   * Fabrique et signe le certificat auto-signé avec la paire courante.
   *
   * Série aléatoire unique (RFC 5280 §4.1.2.2), `notBefore` reculé (décalage
   * d'horloge du client), SAN DNS + IP (config explicite sinon dérivé), signé
   * avec le hachage configuré — jamais SHA-1 (collision SHAttered 2017,
   * CA/Browser Forum depuis 2016).
   *
   * @returns le certificat en PEM
   * @throws Si la paire de clés n'a pas été générée
   */
  async createCertificate(): Promise<Buffer> {
    if (!this.keysPair) {
      throw new Error(`KeyPair  not found`);
    }
    const o = this.certOptions.selfSigned;
    const start = Date.now() - o.backdateMinutes * 60_000;
    const pem = await createSelfSignedCertificate({
      privateKey: this.keysPair.privateKey,
      publicKey: this.keysPair.publicKey,
      serialHex: Certificate.generateSerialHex(),
      notBefore: new Date(start),
      notAfter: new Date(start + o.validityDays * 86_400_000),
      attributes: o.attrs,
      dns: this.sanDnsNames(),
      ip: this.sanIps(),
      hash: this.allowedHash(o.hash),
    });
    return Buffer.from(pem);
  }

  /**
   * Résumé introspectable du certificat serveur courant — réutilisé par la
   * commande CLI `certificates` et un futur endpoint d'admin Studio (parité
   * CLI ↔ Web).
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
    try {
      const cert = new X509Certificate(this.cert);
      info.serial = cert.serialNumber.toLowerCase();
      info.validFrom = cert.validFromDate.toISOString();
      info.validTo = cert.validToDate.toISOString();
      info.signatureAlgorithm = signatureAlgorithmName(
        signatureAlgorithmOid(cert.raw),
      );
      const cn = cert.subject
        ? distinguishedNameField(cert.subject, "CN")
        : null;
      if (cn !== null) {
        info.commonName = cn;
      }
      const san = parseSubjectAltName(cert.subjectAltName);
      if (san.dns.length > 0 || san.ip.length > 0) {
        info.san = [...san.dns, ...san.ip];
      }
    } catch {
      // Certificat illisible (fourni externe au format inattendu) → résumé partiel.
    }
    return info;
  }

  /** Hachage configuré, ramené à SHA-256 s'il sort du contrat (jamais SHA-1). */
  private allowedHash(hash: CertHash): CertHash {
    switch (hash) {
      case "sha512":
      case "sha384":
      case "sha256":
        return hash;
      default: {
        // Valeur hors contrat (config non validée) : relue en `string` pour le
        // message — le type l'a épuisée (`never`).
        const refused: string = hash;
        this.log(
          `Hachage '${refused}' refusé (SHA-1 interdit) → SHA-256.`,
          "WARNING",
        );
        return "sha256";
      }
    }
  }
}

export default Certificate;
