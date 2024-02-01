/* eslint-disable @typescript-eslint/no-explicit-any */
import pkg from "node-forge";
const { pki } = pkg;
import nodefony, { Service, Module, Container, Event } from "nodefony";
import HttpKernel from "./http-kernel";
import fs from "fs/promises";
import path, { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";

export interface OpensslOptions {
  size: number;
  attrs: pkg.pki.CertificateField[];
  serialNumber: string | number;
}

export interface CertificateOptions {
  openssl: OpensslOptions;
  path?: string;
  keyPath?: string;
  certPath?: string;
  caPath?: string;
  key?: Buffer;
  cert?: Buffer;
  ca?: Buffer;
}

interface filesCertType {
  path: string;
  variable: string | Buffer | null;
}

const defaultOptions: CertificateOptions = {
  path: resolve(".", "nodefony", "config", "certificates"),
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

  path: string = resolve(".", "nodefony", "config", "certificates");
  clientPath: string = resolve(this.path, "client");
  serverParh: string = resolve(this.path, "server");
  caPath: string = resolve(this.path, "ca", "nodefony-root-ca.crt.pem");
  publicKeyPath: string = resolve(this.path, "server", "publickey.pem");
  privateKeyPath: string = resolve(this.path, "server", "privkey.pem");
  certPath: string = resolve(this.path, "server", "cert.pem");
  fullchainPath: string = resolve(this.path, "server", "fullchain.pem");
  intermediatePath: string = resolve(this.path, "ca_intermediate");
  constructor(module: Module, httpKernel: HttpKernel) {
    super(
      "certificates",
      module.container as Container,
      module.notificationsCenter as Event,
      nodefony.extend(
        true,
        defaultOptions,
        module.options.certificates || {}
      ) as CertificateOptions
    );
    this.module = module;
    this.setFiles();

    this.kernel?.once("onStart", async () => {
      nodefony.extend(
        true,
        this.options,
        module.options.certificates || {}
      ) as CertificateOptions;
      await this.ensureDirectoriesExist();
      this.options.openssl.serialNumber = Certificate.generateSerial();
      await this.generateServerCertificates();
    });
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
      { path: this.caPath, variable: this.ca },
      { path: this.certPath, variable: this.cert },
      { path: this.fullchainPath, variable: this.fullchainPem },
    ];
  }

  private async checkCertificates(): Promise<boolean> {
    return await Promise.any(
      this.files.map((file) =>
        fs
          .access(file.path)
          .then(() => true)
          .catch(() => false)
      )
    );
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
        this.log(`Directory created: ${directory}`);
      }
    }
  }

  async generateServerCertificates(force: boolean = false): Promise<this> {
    // Check if any file exists
    await this.ensureDirectoriesExist();
    const anyFileExists = await this.checkCertificates();

    if (anyFileExists && !force) {
      return this.readCerticates();
    }
    this.keysPair = this.generateKeys();
    this.certForge = this.createCertificate();
    this.setExtension();
    this.sign();
    this.key = this.generatePrivateKeyPem();
    this.publicKeyPem = this.generatePublickeyPem();
    this.cert = this.generateCertPem();
    this.fullchainPem = this.createFullChain();
    this.setFiles();
    return this.writeCertificates(force).then(() => {
      return this.readCerticates();
    });
  }

  createFullChain(): string {
    return (
      this.cert?.toString() ||
      "" + this.intermediateCertPem?.toString() ||
      "" + this.rootCertPem?.toString() ||
      ""
    );
  }

  async readCerticates(): Promise<this> {
    return new Promise(async (resolve, reject) => {
      for await (const file of this.files) {
        try {
          await fs.access(file.path);
          if (file.path === this.privateKeyPath) {
            this.key = Buffer.from(await fs.readFile(file.path, "utf8"));
          }
          if (file.path === this.publicKeyPath) {
            this.publicKeyPem = Buffer.from(
              await fs.readFile(file.path, "utf8")
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
              await fs.readFile(file.path, "utf8")
            );
          }
          this.log(`Read Certificat file ${file.path}`);
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
            this.log(`File ${file.path} already exists, skipping.`);
            continue; // Skip writing if force is false and file exists
          }
          if (force && fileExists) {
            await fs.unlink(file.path); // Delete existing file if force is true and file exists
            this.log(`Existing file ${file.path} deleted.`);
          }
          await fs.writeFile(file.path, file.variable.toString(), "utf8");
          this.log(`Certificate file ${file.path} written successfully.`);
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
    return pki.rsa.generateKeyPair(this.options.size);
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
        cert.validity.notBefore.getFullYear() + 1
      );
      cert.setSubject(this.options.openssl.attrs);
      cert.setIssuer(this.options.openssl.attrs);
      return cert;
    }
    throw new Error(`KeyPair  not found`);
  }

  setExtension(): void {
    if (this.certForge) {
      return this.certForge.setExtensions([
        {
          name: "basicConstraints",
          cA: true,
        },
        {
          name: "keyUsage",
          keyCertSign: true,
          digitalSignature: true,
          nonRepudiation: true,
          keyEncipherment: true,
          dataEncipherment: true,
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
