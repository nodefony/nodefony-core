/* eslint-disable @typescript-eslint/no-explicit-any */
import pkg from "node-forge";
const { pki } = pkg;
import { Service, Module, Container, Event, extend } from "nodefony";
//import HttpKernel from "./http-kernel";
import fs from "node:fs/promises";
import path, { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { v4 as uuidv4 } from "uuid";

const execFileAsync = promisify(execFile);

export interface OpensslOptions {
  size: number;
  attrs: pkg.pki.CertificateField[];
  serialNumber: string | number;
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

export interface CertificateOptions {
  openssl: OpensslOptions;
  dev: CertificateDevOptions;
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

/** Stratégie de fourniture du certificat serveur. */
type CertStrategy = "explicit" | "mkcert" | "forge";

const defaultOptions: CertificateOptions = {
  path: resolve(".", "nodefony", "config", "certificates"),
  dev: {
    useMkcert: true,
  },
  openssl: {
    size: 2048,
    serialNumber: 1,
    attrs: [],
  },
};

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

  path: string = resolve(".", "nodefony", "config", "certificates");
  clientPath: string = resolve(this.path, "client");
  serverParh: string = resolve(this.path, "server");
  caPath: string = resolve(this.path, "ca", "nodefony-root-ca.crt.pem");
  publicKeyPath: string = resolve(this.path, "server", "publickey.pem");
  privateKeyPath: string = resolve(this.path, "server", "privkey.pem");
  certPath: string = resolve(this.path, "server", "cert.pem");
  fullchainPath: string = resolve(this.path, "server", "fullchain.pem");
  intermediatePath: string = resolve(this.path, "ca_intermediate");
  constructor(module: Module) {
    super(
      "certificates",
      module.container as Container,
      module.notificationsCenter as Event,
      extend(
        true,
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

  async init(): Promise<this> {
    this.options.openssl.serialNumber = Certificate.generateSerial();
    this.kernel?.once("onBoot", async () => {
      this.options = extend(
        true,
        this.options,
        this.module.options.certificates || {},
      ) as CertificateOptions;
      this.setFiles();
      await this.generateServerCertificates();
    });
    return this;
  }

  static generateSerial(): number {
    // Générer un UUID
    const unique_id = uuidv4().replace(/-/g, "");
    // Convertir l'UUID en un nombre binaire
    const binaryNumber = parseInt(unique_id, 16).toString(2);
    // Prendre les 34 premiers chiffres du nombre binaire
    return parseInt(binaryNumber.substring(0, 34), 2);
  }

  setFiles(): void {
    this.files = [
      { path: this.privateKeyPath, variable: this.key },
      { path: this.publicKeyPath, variable: this.publicKeyPem },
      //{ path: this.caPath, variable: this.ca },
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
    const directories = [
      this.path,
      this.clientPath,
      this.intermediatePath,
      this.serverParh,
      path.dirname(this.privateKeyPath),
      path.dirname(this.publicKeyPath),
      path.dirname(this.caPath),
      path.dirname(this.certPath),
      path.dirname(this.fullchainPath),
    ];

    for await (const directory of directories) {
      try {
        await fs.access(directory);
      } catch (err) {
        // Directory does not exist, create it
        await fs.mkdir(directory, { recursive: true });
        this.log(`Directory created: ${directory}`, "DEBUG");
      }
    }
  }

  /**
   * Génère (ou recharge) le certificat serveur selon la stratégie résolue :
   * `explicit` (fourni en config / prod), `mkcert` (dev, CA trustée) ou
   * `forge` (auto-signé node-forge, fallback). Régénère automatiquement si le
   * certificat présent sur disque n'est pas adéquat pour la stratégie active.
   *
   * @param force - forcer la régénération même si un certificat valide existe
   */
  async generateServerCertificates(force: boolean = false): Promise<this> {
    await this.ensureDirectoriesExist();
    const strategy = await this.resolveStrategy();

    // Prod / config : certificat fourni explicitement — chargé tel quel.
    if (strategy === "explicit") {
      return this.loadExplicitCert();
    }

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
      this.cert = this.generateCertPem();
      this.fullchainPem = this.createFullChain();
      this.setFiles();
      // Régénération : on écrase l'ancien matériel (force interne).
      await this.writeCertificates(true);
    }
    return this.readCerticates();
  }

  /**
   * Détermine comment fournir le certificat serveur.
   * - `explicit` : `key` + `cert` fournis en config (prod, Let's Encrypt…).
   * - `mkcert` : dev + `dev.useMkcert` + binaire mkcert + CA locale présents.
   * - `forge` : fallback auto-signé (CI, mkcert absent, prod sans cert fourni).
   */
  private async resolveStrategy(): Promise<CertStrategy> {
    if (this.hasExplicitCert()) {
      return "explicit";
    }
    if (this.isDev() && this.certOptions.dev?.useMkcert !== false) {
      const caRoot = await this.detectMkcert();
      if (caRoot) {
        this.mkcertCaRoot = caRoot;
        return "mkcert";
      }
      this.log(
        "mkcert introuvable — fallback certificat auto-signé node-forge (non trusté). " +
          "`brew install mkcert nss && mkcert -install` pour un HTTPS dev sans erreur (HMR cross-origin/WSS).",
        "WARNING",
      );
    }
    return "forge";
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

  /** Hostnames couverts par le certificat (SAN). */
  private certHostnames(): string[] {
    const names = ["localhost", "127.0.0.1", "::1"];
    const domain = this.kernel?.domain;
    if (domain && !names.includes(domain)) {
      names.unshift(domain);
    }
    return names;
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
    const rootCaPem = await fs.readFile(
      path.join(caRoot, "rootCA.pem"),
      "utf8",
    );
    const certPem = await fs.readFile(this.certPath, "utf8");
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
   * - `mkcert` : émis par la CA mkcert (issuer organisation contient "mkcert").
   * - `forge` : possède une extension subjectAltName (sinon ancien cert sans SAN).
   * @returns false si absent, illisible ou inadéquat → déclenche la régénération.
   */
  private async isCertAdequate(strategy: CertStrategy): Promise<boolean> {
    try {
      const certPem = await fs.readFile(this.certPath, "utf8");
      const cert = pki.certificateFromPem(certPem);
      if (strategy === "mkcert") {
        const org = cert.issuer.getField("O");
        return Boolean(org && /mkcert/i.test(String(org.value)));
      }
      return Boolean(cert.getExtension("subjectAltName"));
    } catch {
      return false;
    }
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
    return new Promise(async (resolve) => {
      for await (const file of this.files) {
        try {
          await fs.access(file.path);
          if (file.path === this.privateKeyPath) {
            this.key = Buffer.from(await fs.readFile(file.path, "utf8"));
          }
          if (file.path === this.publicKeyPath) {
            this.publicKeyPem = Buffer.from(
              await fs.readFile(file.path, "utf8"),
            );
          }
          if (file.path === this.caPath) {
            this.ca = Buffer.from(await fs.readFile(file.path, "utf8"));
          }
          if (file.path === this.certPath) {
            this.cert = Buffer.from(await fs.readFile(file.path, "utf8"));
          }
          if (file.path === this.fullchainPath) {
            this.fullchainPem = Buffer.from(
              await fs.readFile(file.path, "utf8"),
            );
          }
          this.log(`Read Certificat file ${file.path}`, "DEBUG");
        } catch (err) {
          //this.log(`Create file ${file.path}`);
          this.log(err, "WARNING");
        }
      }
      return resolve(this);
    });
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
          await fs.writeFile(file.path, file.variable.toString(), "utf8");
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
    return this;
  }

  generateKeys(): pkg.pki.rsa.KeyPair {
    // Générer une paire de clés
    return pki.rsa.generateKeyPair(this.certOptions.openssl.size);
  }
  generatePrivateKeyPem(): Buffer {
    if (this.keysPair) {
      return Buffer.from(pki.privateKeyToPem(this.keysPair.privateKey));
    }
    throw new Error(`pki.rsa.KeyPair  not found`);
  }
  generatePublickeyPem(): Buffer {
    if (this.keysPair)
      return Buffer.from(pki.publicKeyToPem(this.keysPair.publicKey));
    throw new Error(`pki.rsa.KeyPair  not found`);
  }
  generateCertPem(): Buffer {
    if (this.certForge) {
      return Buffer.from(pki.certificateToPem(this.certForge));
    }
    throw new Error(`pki.Certificate  not found`);
  }

  createCertificate(): pkg.pki.Certificate {
    // Créer un certificat
    if (this.keysPair) {
      const cert = pki.createCertificate();
      cert.publicKey = this.keysPair.publicKey;
      cert.serialNumber = "01"; //this.options.openssl.serialNumber;
      cert.validity.notBefore = new Date();
      // Valide pour un an
      cert.validity.notAfter.setFullYear(
        cert.validity.notBefore.getFullYear() + 1,
      );
      cert.setSubject(this.certOptions.openssl.attrs);
      cert.setIssuer(this.certOptions.openssl.attrs);
      return cert;
    }
    throw new Error(`KeyPair  not found`);
  }

  /** subjectAltName du fallback auto-signé (localhost + IP loopback + domaine). */
  private altNames(): AltName[] {
    const out: AltName[] = [
      { type: 2, value: "localhost" },
      { type: 7, ip: "127.0.0.1" },
      { type: 7, ip: "::1" },
    ];
    const domain = this.kernel?.domain;
    if (domain && domain !== "localhost") {
      out.unshift({ type: 2, value: domain });
    }
    return out;
  }

  setExtension(): void {
    if (this.certForge) {
      return this.certForge.setExtensions([
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
      ]);
    }
    throw new Error(`pki.Certificate  not found`);
  }

  sign(): void {
    if (this.certForge && this.keysPair) {
      // Autosigner le certificat
      return this.certForge.sign(this.keysPair.privateKey);
    }
    throw new Error(`pki.rsa.KeyPair or pki.Certificate  not found`);
  }
}

export default Certificate;
