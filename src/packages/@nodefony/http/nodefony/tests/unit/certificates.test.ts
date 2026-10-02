/// <reference types="node" />
import { expect } from "vitest";
import { type Module } from "nodefony";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import Certificate, { type IRsaKeyPair } from "../../service/certificates.js";
import {
  createSelfSignedCertificate,
  ipAddressBytes,
  parseSubjectAltName,
  signatureAlgorithmOid,
} from "../../service/x509.js";

const SHA1_RSA = "1.2.840.113549.1.1.5";
const SHA256_RSA = "1.2.840.113549.1.1.11";
const SHA512_RSA = "1.2.840.113549.1.1.13";
const SAN_CRITICAL = Buffer.from("0603551d110101ff", "hex");

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
  c.caPath = path.join(dir, "ca", "nodefony-root-ca.crt.pem");
  c.publicKeyPath = path.join(dir, "server", "publickey.pem");
  c.privateKeyPath = path.join(dir, "server", "privkey.pem");
  c.certPath = path.join(dir, "server", "cert.pem");
  c.fullchainPath = path.join(dir, "server", "fullchain.pem");
}

describe("certificates — conformité crypto de l'auto-signé", () => {
  // Une seule paire de clés (keygen RSA coûteux) réutilisée par les assertions.
  let sharedKeys: IRsaKeyPair;
  let pem: Buffer;
  let parsed: X509Certificate;

  beforeAll(async () => {
    const c = makeCert({
      selfSigned: { attrs: [{ name: "commonName", value: "nodefony.com" }] },
      san: { dns: ["nodefony.com", "localhost"], ip: ["127.0.0.1", "::1"] },
    });
    sharedKeys = await c.generateKeys();
    c.keysPair = sharedKeys;
    pem = await c.createCertificate();
    parsed = new X509Certificate(pem);
  });

  it("porte une signature qui se VÉRIFIE par sa propre clé (DER bien formé)", () => {
    expect(parsed.verify(parsed.publicKey)).to.equal(true);
    expect(parsed.checkPrivateKey(sharedKeys.privateKey)).to.equal(true);
  });

  it("signe en SHA-256 (jamais SHA-1)", () => {
    expect(signatureAlgorithmOid(parsed.raw)).to.equal(SHA256_RSA);
  });

  it("numéro de série aléatoire ≥ 64 bits, jamais la valeur fixe '01'", () => {
    expect(parsed.serialNumber).to.match(/^[0-9A-F]+$/);
    expect(parsed.serialNumber).to.not.equal("01");
    // ≥ 16 hex = ≥ 8 octets = ≥ 64 bits (on en génère 16 octets = 128 bits).
    expect(parsed.serialNumber.length).to.be.greaterThanOrEqual(16);
  });

  it("génère un série DIFFÉRENT à chaque certificat (unicité RFC 5280)", async () => {
    const c = makeCert();
    c.keysPair = sharedKeys;
    const second = new X509Certificate(await c.createCertificate());
    expect(second.serialNumber).to.not.equal(parsed.serialNumber);
  });

  it("porte un SAN couvrant les noms DNS et IP demandés (RFC 6125)", () => {
    expect(parsed.checkHost("nodefony.com")).to.equal("nodefony.com");
    expect(parsed.checkHost("localhost")).to.equal("localhost");
    expect(parsed.checkIP("127.0.0.1")).to.equal("127.0.0.1");
    expect(parsed.checkIP("::1")).to.equal("::1");
    expect(parsed.checkHost("autre.example")).to.equal(undefined);
  });

  it("est un certificat feuille (cA=false), usage serveur, avec SKI", () => {
    expect(parsed.ca).to.equal(false);
    expect(parsed.keyUsage).to.include("1.3.6.1.5.5.7.3.1"); // serverAuth
    expect(parsed.subject).to.equal("CN=nodefony.com");
    expect(parsed.issuer).to.equal(parsed.subject); // auto-signé
    // Sujet présent : le SAN n'a pas à être critique.
    expect(parsed.raw.includes(SAN_CRITICAL)).to.equal(false);
    expect(parsed.toLegacyObject().ext_key_usage).to.be.ok;
  });

  it("recule notBefore et applique une validité ~365 jours", () => {
    const now = Date.now();
    const notBefore = parsed.validFromDate.getTime();
    // Le DER est à la seconde : 1 s de tolérance vers le haut.
    expect(notBefore).to.be.lessThanOrEqual(now + 1000);
    expect(notBefore).to.be.greaterThan(now - 10 * 60_000);
    const spanDays = (parsed.validToDate.getTime() - notBefore) / 86_400_000;
    expect(spanDays).to.be.greaterThan(364);
    expect(spanDays).to.be.lessThan(366);
  });

  it("respecte le hachage configuré (sha512)", async () => {
    const c = makeCert({ selfSigned: { hash: "sha512" } });
    c.keysPair = sharedKeys;
    const re = new X509Certificate(await c.createCertificate());
    expect(signatureAlgorithmOid(re.raw)).to.equal(SHA512_RSA);
    expect(re.verify(re.publicKey)).to.equal(true);
  });

  it("refuse un attribut de sujet inconnu en le NOMMANT", async () => {
    const c = makeCert({
      selfSigned: { attrs: [{ name: "commonNom", value: "x" }] },
    });
    c.keysPair = sharedKeys;
    await expect(c.createCertificate()).rejects.toThrow(/commonNom/);
  });

  // La preuve qui compte : un vrai client TLS, contrôle ACTIVÉ, accepte le
  // certificat pour `localhost` en le prenant pour ancre de confiance.
  it("est accepté par une poignée de main TLS VÉRIFIÉE (hôte localhost)", async () => {
    const server = tls.createServer(
      {
        key: sharedKeys.privateKey.export({ type: "pkcs1", format: "pem" }),
        cert: pem,
      },
      (socket) => socket.end(),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const authorized = await new Promise<boolean>((resolve, reject) => {
        const socket = tls.connect(
          { host: "127.0.0.1", port, servername: "localhost", ca: pem },
          () => {
            resolve(socket.authorized);
            socket.destroy();
          },
        );
        socket.on("error", reject);
      });
      expect(authorized).to.equal(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("x509 — encodage pur", () => {
  it("encode IPv4 et IPv6 (compressé, IPv4 embarquée) en octets réseau", () => {
    expect([...ipAddressBytes("127.0.0.1")]).to.deep.equal([127, 0, 0, 1]);
    expect(ipAddressBytes("::1").toString("hex")).to.equal(
      "00000000000000000000000000000001",
    );
    expect(ipAddressBytes("2001:db8::1").toString("hex")).to.equal(
      "20010db8000000000000000000000001",
    );
    expect(ipAddressBytes("::ffff:192.0.2.1").toString("hex")).to.equal(
      "00000000000000000000ffffc0000201",
    );
    expect(() => ipAddressBytes("pas-une-ip")).to.throw(/invalide/);
  });

  it("lit le SAN tel que Node le rend", () => {
    expect(
      parseSubjectAltName("DNS:localhost, DNS:a.b, IP Address:127.0.0.1"),
    ).to.deep.equal({ dns: ["localhost", "a.b"], ip: ["127.0.0.1"] });
    expect(parseSubjectAltName(undefined)).to.deep.equal({ dns: [], ip: [] });
  });

  it("sujet vide → SAN CRITIQUE (RFC 5280 §4.2.1.6), série à bit de tête préfixée", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = await createSelfSignedCertificate({
      privateKey,
      publicKey,
      serialHex: "ff00", // bit de poids fort à 1 → un 0x00 doit le précéder
      notBefore: new Date("2049-12-31T23:59:59Z"),
      notAfter: new Date("2050-01-01T00:00:01Z"), // bascule GeneralizedTime
      attributes: [],
      dns: ["localhost"],
      ip: [],
      hash: "sha256",
    });
    const x = new X509Certificate(pem);
    expect(x.verify(x.publicKey)).to.equal(true);
    expect(x.subject).to.equal(undefined);
    // Lu POSITIF : sans le 0x00 de tête, le même DER serait un entier négatif.
    expect(x.serialNumber).to.equal("FF00");
    expect(x.validToDate.toISOString()).to.equal("2050-01-01T00:00:01.000Z");
    expect(x.validFromDate.toISOString()).to.equal("2049-12-31T23:59:59.000Z");
    expect(x.toLegacyObject().subjectaltname).to.equal("DNS:localhost");
    // Node n'expose pas le drapeau « critique » : lu dans le DER — OID
    // subjectAltName (06 03 55 1d 11) suivi de BOOLEAN TRUE (01 01 ff).
    expect(x.raw.includes(SAN_CRITICAL)).to.equal(true);
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

  // ── writeCertificates : les trois issues, depuis que la décision « le fichier
  // existe-t-il ? » n'est plus un `access` préalable mais le drapeau `wx` de la
  // création. Le comportement observable ne devait pas bouger : ces cas le
  // FIGENT.
  //
  // Ce que le débranchement a montré, et qu'il faut savoir en les lisant : seul
  // le premier DISCRIMINE ce changement (retiré `wx`, il tombe). Le deuxième
  // passe aussi avec un écrasement naïf, et le troisième vérifie une garantie
  // portée par `restrictPrivateKey` — un chmod explicite qui existait avant.
  // Ils gardent leur valeur de non-régression ; ils ne prouvent pas le TOCTOU.
  writeIt("n'écrase PAS un fichier existant sans force (skip)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
    try {
      const c = makeCert({ san: { dns: ["localhost"], ip: ["127.0.0.1"] } });
      setPaths(c, dir);
      await c.generateServerCertificates(true);

      // TÉMOIN : sans lui, le test passerait même si le fichier était réécrit —
      // `writeCertificates` réécrit le MÊME contenu, donc comparer avant/après
      // ne distingue pas « sauté » de « réécrit à l'identique ».
      await fs.writeFile(c.certPath, "SENTINELLE", "utf8");

      // Un second passage SANS force doit laisser le disque intact.
      await c.writeCertificates(false);
      expect(await fs.readFile(c.certPath, "utf8")).to.equal("SENTINELLE");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  writeIt("force=true réécrit le fichier existant", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
    try {
      const c = makeCert({ san: { dns: ["localhost"], ip: ["127.0.0.1"] } });
      setPaths(c, dir);
      await c.generateServerCertificates(true);
      await fs.writeFile(c.certPath, "SENTINELLE", "utf8");

      await c.writeCertificates(true);
      const apres = await fs.readFile(c.certPath, "utf8");
      expect(apres).to.not.equal("SENTINELLE");
      expect(apres).to.match(/BEGIN CERTIFICATE/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  writeIt(
    "après force=true, la clé privée est en 0600 même laissée world-readable " +
      "(garantie de restrictPrivateKey, pas du mode de writeFile)",
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cert-"));
      try {
        const c = makeCert({ san: { dns: ["localhost"], ip: ["127.0.0.1"] } });
        setPaths(c, dir);
        await c.generateServerCertificates(true);

        // Quelqu'un (ou un déploiement) a relâché les permissions.
        await fs.chmod(c.privateKeyPath, 0o644);
        expect((await fs.stat(c.privateKeyPath)).mode & 0o777).to.equal(0o644);

        await c.writeCertificates(true);
        expect((await fs.stat(c.privateKeyPath)).mode & 0o777).to.equal(0o600);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );

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
      // Écrit un cert SHA-1 + fichiers requis.
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const certPem = await createSelfSignedCertificate({
        privateKey,
        publicKey,
        serialHex: "01",
        notBefore: new Date(Date.now() - 86_400_000),
        notAfter: new Date(Date.now() + 86_400_000 * 365),
        attributes: [{ name: "commonName", value: "localhost" }],
        dns: ["localhost"],
        ip: [],
        hash: "sha1",
      });
      expect(signatureAlgorithmOid(new X509Certificate(certPem).raw)).to.equal(
        SHA1_RSA,
      );
      await fs.mkdir(c.serverPath, { recursive: true });
      await fs.writeFile(c.certPath, certPem);
      await fs.writeFile(
        c.privateKeyPath,
        privateKey.export({ type: "pkcs1", format: "pem" }),
      );
      await fs.writeFile(
        c.publicKeyPath,
        publicKey.export({ type: "spki", format: "pem" }),
      );
      await fs.writeFile(c.fullchainPath, certPem);

      // Reload sans force : SHA-1 = inadéquat → régénération en SHA-256.
      await c.generateServerCertificates();
      const re = new X509Certificate(await fs.readFile(c.certPath));
      expect(signatureAlgorithmOid(re.raw)).to.equal(SHA256_RSA);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    // DEUX paires RSA 2048 : celle du décor, puis celle que le code régénère — les
    // autres cas du fichier mutualisent une paire unique, une régénération ne le
    // peut pas. La génération RSA est probabiliste (recherche de premiers) : sa
    // durée varie d'un tirage à l'autre et d'un runner à l'autre. Le budget est
    // donc EXPLICITE et large : il ne se paie que dans le cas lent.
  }, 60_000);
});

/**
 * Fabriquer un certificat est une ÉCRITURE DISQUE. Elle n'a de sens que si un
 * serveur TLS existe — et elle est refusée là où l'application n'a pas le droit
 * d'écrire, c'est-à-dire dans son image, dont le code appartient à `root` quand
 * le processus tourne en `1000`.
 *
 * Vécu, et bloquant : le hook `onBoot` s'armait INCONDITIONNELLEMENT. Dans une
 * image générée, il mourait en `EACCES` sur `nodefony/config/certificates`, le
 * hook était « critique », et l'application ne démarrait pas — quel que soit son
 * préset, et alors même que la production coupe son écoute TLS exprès.
 */
describe("certificates — on ne fabrique QUE ce dont un serveur TLS a besoin", () => {
  /** Le service, avec la config serveur que le kernel lui exposerait. */
  function certAvecServeurs(servers: unknown): Certificate {
    const hooks: string[] = [];
    const fakeModule = {
      container: null,
      notificationsCenter: false,
      options: { certificates: {} },
      kernel: {
        options: { servers },
        once: (event: string) => hooks.push(event),
      },
    };
    const c = new Certificate(fakeModule as unknown as Module);
    // Le service prend son kernel dans le CONTENEUR (`Service.ts`), que ce décor
    // n'a pas : on le pose à la main, sinon `this.kernel?.once` ne ferait rien et
    // le cas positif passerait pour une raison qui n'est pas la sienne.
    (c as unknown as { kernel: unknown }).kernel = fakeModule.kernel;
    (c as unknown as { hooksPoses: string[] }).hooksPoses = hooks;
    return c;
  }

  const hooksDe = (c: Certificate): string[] =>
    (c as unknown as { hooksPoses: string[] }).hooksPoses;

  it("aucun hook de boot quand l'écoute TLS est COUPÉE (`https: false`)", async () => {
    const c = certAvecServeurs({ http: { port: 5151 }, https: false });
    await c.init();
    expect(hooksDe(c)).to.deep.equal([]);
  });

  it("aucun hook de boot quand aucun serveur n'est déclaré", async () => {
    const c = certAvecServeurs({});
    await c.init();
    expect(hooksDe(c)).to.deep.equal([]);
  });

  // Le pendant, sans lequel le cas précédent ne prouverait rien : un serveur TLS
  // déclaré DOIT encore obtenir son certificat (le développement en dépend).
  it("le hook est posé dès qu'un serveur TLS est déclaré", async () => {
    const c = certAvecServeurs({ https: { port: 5152 } });
    await c.init();
    expect(hooksDe(c)).to.deep.equal(["onBoot"]);
  });
});
