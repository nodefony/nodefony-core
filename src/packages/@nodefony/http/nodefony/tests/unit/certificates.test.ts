/// <reference types="node" />
import { expect } from "chai";
import { type Module } from "nodefony";
import pkg from "node-forge";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Certificate from "../../service/certificates.js";

const { pki } = pkg;

/**
 * Instancie le service certificates avec un module factice (kernel absent →
 * `isDev()` faux → stratégie auto-signée). `notificationsCenter: false` évite
 * de monter un bus d'événements.
 */
function makeCert(certOpts: Record<string, unknown> = {}): Certificate {
  const fakeModule = {
    container: null,
    notificationsCenter: false,
    options: { certificates: certOpts },
  };
  return new Certificate(fakeModule as unknown as Module);
}

/** Redirige toutes les sorties disque du service vers un dossier temporaire. */
function setPaths(c: Certificate, dir: string): void {
  c.path = dir;
  c.serverPath = path.join(dir, "server");
  c.clientPath = path.join(dir, "client");
  c.intermediatePath = path.join(dir, "ca_intermediate");
  c.caPath = path.join(dir, "ca", "nodefony-root-ca.crt.pem");
  c.publicKeyPath = path.join(dir, "server", "publickey.pem");
  c.privateKeyPath = path.join(dir, "server", "privkey.pem");
  c.certPath = path.join(dir, "server", "cert.pem");
  c.fullchainPath = path.join(dir, "server", "fullchain.pem");
}

describe("certificates — conformité crypto de l'auto-signé", () => {
  // Une seule paire de clés (keygen RSA coûteux) réutilisée par les assertions.
  let sharedKeys: pkg.pki.rsa.KeyPair;
  let parsed: pkg.pki.Certificate;
  let firstSerial: string;

  beforeAll(async () => {
    const c = makeCert({
      openssl: { attrs: [{ name: "commonName", value: "nodefony.com" }] },
      san: { dns: ["nodefony.com", "localhost"], ip: ["127.0.0.1"] },
    });
    await c.loadForge();
    sharedKeys = c.generateKeys();
    c.keysPair = sharedKeys;
    c.certForge = c.createCertificate();
    firstSerial = c.certForge.serialNumber;
    c.setExtension();
    c.sign();
    parsed = pki.certificateFromPem(c.generateCertPem().toString());
  });

  it("signe en SHA-256 (jamais SHA-1)", () => {
    expect(parsed.signatureOid).to.equal(pki.oids.sha256WithRSAEncryption);
    expect(parsed.signatureOid).to.not.equal(pki.oids.sha1WithRSAEncryption);
  });

  it("numéro de série aléatoire ≥ 64 bits, jamais la valeur fixe '01'", () => {
    expect(parsed.serialNumber).to.match(/^[0-9a-f]+$/);
    expect(parsed.serialNumber).to.not.equal("01");
    // ≥ 16 hex = ≥ 8 octets = ≥ 64 bits (on en génère 16 octets = 128 bits).
    expect(parsed.serialNumber.length).to.be.greaterThanOrEqual(16);
  });

  it("génère un série DIFFÉRENT à chaque certificat (unicité RFC 5280)", async () => {
    const c = makeCert();
    await c.loadForge();
    c.keysPair = sharedKeys;
    const second = c.createCertificate().serialNumber;
    expect(second).to.not.equal(firstSerial);
  });

  it("porte un SAN couvrant les noms DNS demandés (RFC 6125)", () => {
    const ext = parsed.getExtension("subjectAltName") as {
      altNames: { type: number; value?: string }[];
    };
    const dns = ext.altNames.filter((a) => a.type === 2).map((a) => a.value);
    expect(dns).to.include("nodefony.com");
    expect(dns).to.include("localhost");
  });

  it("est un certificat feuille (basicConstraints cA=false) avec SKI", () => {
    const bc = parsed.getExtension("basicConstraints") as { cA?: boolean };
    expect(bc.cA).to.equal(false);
    expect(parsed.getExtension("subjectKeyIdentifier")).to.be.ok;
  });

  it("recule notBefore et applique une validité ~365 jours", () => {
    const now = Date.now();
    expect(parsed.validity.notBefore.getTime()).to.be.lessThanOrEqual(now);
    // backdaté d'au plus ~10 min
    expect(parsed.validity.notBefore.getTime()).to.be.greaterThan(
      now - 10 * 60_000,
    );
    const spanDays =
      (parsed.validity.notAfter.getTime() -
        parsed.validity.notBefore.getTime()) /
      86_400_000;
    expect(spanDays).to.be.greaterThan(364);
    expect(spanDays).to.be.lessThan(366);
  });

  it("respecte le hachage configuré (sha512)", async () => {
    const c = makeCert({ openssl: { hash: "sha512" } });
    await c.loadForge();
    c.keysPair = sharedKeys;
    c.certForge = c.createCertificate();
    c.setExtension();
    c.sign();
    const re = pki.certificateFromPem(c.generateCertPem().toString());
    expect(re.signatureOid).to.equal(pki.oids.sha512WithRSAEncryption);
  });
});

describe("certificates — écriture sécurisée + stratégies", () => {
  const writeIt = process.platform === "win32" ? it.skip : it;

  writeIt("écrit la clé privée en 0600 (jamais world-readable)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
    try {
      const c = makeCert({ san: { dns: ["localhost"], ip: ["127.0.0.1"] } });
      setPaths(c, dir);
      await c.generateServerCertificates(true);
      const st = await fs.stat(c.privateKeyPath);
      expect(st.mode & 0o777).to.equal(0o600);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("strategy='explicit' sans key/cert → échoue clairement", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
    try {
      const c = makeCert({ strategy: "explicit" });
      setPaths(c, dir);
      let message = "";
      try {
        await c.generateServerCertificates();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).to.match(/explicit/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("régénère un certificat SHA-1 présent sur disque en SHA-256", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
    try {
      const c = makeCert({ san: { dns: ["localhost"], ip: ["127.0.0.1"] } });
      setPaths(c, dir);
      // Écrit un cert SHA-1 (signature par défaut node-forge) + fichiers requis.
      const keys = pki.rsa.generateKeyPair(2048);
      const old = pki.createCertificate();
      old.publicKey = keys.publicKey;
      old.serialNumber = "01";
      old.validity.notBefore = new Date(Date.now() - 86_400_000);
      old.validity.notAfter = new Date(Date.now() + 86_400_000 * 365);
      const attrs = [{ name: "commonName", value: "localhost" }];
      old.setSubject(attrs);
      old.setIssuer(attrs);
      old.setExtensions([
        { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] },
      ]);
      old.sign(keys.privateKey); // SHA-1 (pas de digest passé)
      await fs.mkdir(c.serverPath, { recursive: true });
      const certPem = pki.certificateToPem(old);
      await fs.writeFile(c.certPath, certPem);
      await fs.writeFile(
        c.privateKeyPath,
        pki.privateKeyToPem(keys.privateKey),
      );
      await fs.writeFile(c.publicKeyPath, pki.publicKeyToPem(keys.publicKey));
      await fs.writeFile(c.fullchainPath, certPem);

      // Reload sans force : SHA-1 = inadéquat → régénération en SHA-256.
      await c.generateServerCertificates();
      const re = pki.certificateFromPem(await fs.readFile(c.certPath, "utf8"));
      expect(re.signatureOid).to.equal(pki.oids.sha256WithRSAEncryption);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
