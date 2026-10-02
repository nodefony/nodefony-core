import { expect } from "vitest";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import {
  type ICertificateAttribute,
  createSelfSignedCertificate,
  distinguishedNameField,
  ipAddressBytes,
  parseSubjectAltName,
  signatureAlgorithmName,
  signatureAlgorithmOid,
} from "../../service/x509.js";

/**
 * Red-team #20 (passe 1, threat-first) — les LECTURES du module x509 maison.
 *
 * Un `cert.pem` posé à la main, ou fabriqué par un outil tiers, alimente ces
 * fonctions ; le verdict décide si le certificat couvre un hôte et s'il faut le
 * régénérer. Attaques : DER tronqué ou aux longueurs hostiles (lecture hors
 * borne, boucle), virgule ENTRE GUILLEMETS dans le SAN (CVE-2021-44532 : Node
 * échappe ces valeurs — un découpage naïf fabrique un nom couvert de plus), DN à
 * plusieurs lignes, IP malformées. Exigé : refus NOMMÉ ou lecture exacte, jamais
 * un résultat inventé.
 */
describe("red-team x509 — DER hostile", () => {
  const ATTAQUES: Array<[string, Buffer]> = [
    ["vide", Buffer.alloc(0)],
    ["un octet", Buffer.from([0x30])],
    ["SEQUENCE tronquée", Buffer.from("3082ffff3003", "hex")],
    ["longueur sur 4 octets géante", Buffer.from("3084ffffffff00", "hex")],
    [
      "longueur sur 0x80 (indéfinie, interdite en DER)",
      Buffer.from("308000", "hex"),
    ],
    ["longueur sur 9 octets", Buffer.from("3089ffffffffffffffffff", "hex")],
    ["SEQUENCE vide", Buffer.from("3000", "hex")],
    [
      "imbrication profonde",
      Buffer.concat([Buffer.from("30".repeat(1), "hex"), Buffer.alloc(0)]),
    ],
    [
      "octets aléatoires",
      Buffer.from("deadbeefcafebabe0011223344556677", "hex"),
    ],
  ];

  for (const [nom, der] of ATTAQUES) {
    it(`signatureAlgorithmOid(${nom}) lève, ne rend rien d'inventé`, () => {
      expect(() => signatureAlgorithmOid(der)).toThrow();
    });
  }

  it("imbrication de 10 000 SEQUENCE : refus borné, pas de débordement de pile", () => {
    const depth = 10_000;
    let inner = Buffer.alloc(0);
    for (let i = 0; i < depth; i++) {
      const len = inner.length;
      const head =
        len < 0x80
          ? Buffer.from([0x30, len])
          : len < 0x100
            ? Buffer.from([0x30, 0x81, len])
            : len < 0x10000
              ? Buffer.from([0x30, 0x82, len >> 8, len & 0xff])
              : Buffer.from([
                  0x30,
                  0x83,
                  len >> 16,
                  (len >> 8) & 0xff,
                  len & 0xff,
                ]);
      inner = Buffer.concat([head, inner]);
    }
    expect(() => signatureAlgorithmOid(inner)).toThrow();
  });

  it("contrôle positif : l'OID d'un vrai certificat est lu", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const now = Date.now();
    const pem = await createSelfSignedCertificate({
      privateKey,
      publicKey,
      serialHex: "01",
      notBefore: new Date(now),
      notAfter: new Date(now + 86_400_000),
      attributes: [{ shortName: "CN", value: "localhost" }],
      dns: ["localhost"],
      ip: [],
      hash: "sha256",
    });
    const der = new X509Certificate(pem).raw;
    expect(signatureAlgorithmOid(der)).toBe("1.2.840.113549.1.1.11");
    // Le MÊME certificat amputé de sa signature : l'OID reste lisible, seule
    // la longueur annoncée de l'enveloppe trahit la troncature.
    expect(() =>
      signatureAlgorithmOid(der.subarray(0, der.length - 64)),
    ).toThrow(/tronqué/);
  });
});

/** Certificat RÉEL : ce que Node rend se lit, il ne se suppose pas. */
async function realCert(
  attributes: ICertificateAttribute[],
  dns: string[],
): Promise<X509Certificate> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const now = Date.now();
  return new X509Certificate(
    await createSelfSignedCertificate({
      privateKey,
      publicKey,
      serialHex: "01",
      notBefore: new Date(now),
      notAfter: new Date(now + 86_400_000),
      attributes,
      dns,
      ip: [],
      hash: "sha256",
    }),
  );
}

describe("red-team x509 — SAN (CVE-2021-44532)", () => {
  it("un dNSName qui CONTIENT « , DNS:localhost » ne couvre pas localhost", async () => {
    const cert = await realCert(
      [{ shortName: "CN", value: "x" }],
      ["a, DNS:localhost, DNS:b", "c, IP Address:127.0.0.1"],
    );
    const san = parseSubjectAltName(cert.subjectAltName);
    expect(san.dns).toEqual([
      "a, DNS:localhost, DNS:b",
      "c, IP Address:127.0.0.1",
    ]);
    expect(san.ip).toEqual([]);
  });

  it("contrôle positif : liste ordinaire lue entière", () => {
    const san = parseSubjectAltName(
      "DNS:localhost, DNS:a.test, IP Address:127.0.0.1",
    );
    expect(san.dns).toEqual(["localhost", "a.test"]);
    expect(san.ip).toEqual(["127.0.0.1"]);
  });
});

describe("red-team x509 — DN", () => {
  it("un CN qui CONTIENT « \\nO=evil » n'injecte pas une seconde clé", async () => {
    const cert = await realCert(
      [
        { shortName: "CN", value: "a\nO=evil" },
        { shortName: "O", value: "Real" },
      ],
      ["x"],
    );
    expect(distinguishedNameField(cert.subject, "O")).toBe("Real");
  });

  it("contrôle positif : clé trouvée sur un DN multi-lignes", () => {
    expect(distinguishedNameField("C=FR\nO=Nodefony\nCN=localhost", "CN")).toBe(
      "localhost",
    );
  });
});

describe("red-team x509 — IP de config", () => {
  for (const ip of [
    "1.2.3.256",
    "1.2.3",
    "",
    "::g",
    "1.2.3.4.5",
    "localhost",
  ]) {
    it(`ipAddressBytes(« ${ip} ») lève`, () => {
      expect(() => ipAddressBytes(ip)).toThrow();
    });
  }

  it("contrôle positif : v4 et v6", () => {
    expect(ipAddressBytes("127.0.0.1")).toEqual(Buffer.from([127, 0, 0, 1]));
    expect(ipAddressBytes("::1").length).toBe(16);
  });
});

/**
 * Red-team #20 (passe 2, code-first) — les branches que la passe 1 n'a pas
 * touchées : encodage des noms à la FABRICATION, entrées SAN d'autres types,
 * valeurs citées malformées, attributs de config invalides.
 */
describe("red-team x509 — passe 2 : fabrication depuis la config", () => {
  for (const [label, dns] of [
    // `ascii` de Node garde l'octet BAS : U+012E devient « . » — le certificat
    // couvrirait `evil.localhost`, un nom que personne n'a configuré.
    ["octet haut tronqué en « . »", "evil\u012Elocalhost"],
    ["IDN non converti en punycode", "café.test"],
    ["retour à la ligne", "a\nb.test"],
    ["octet nul", "a\u0000.test"],
    ["vide", ""],
  ] as const) {
    it(`dNSName ${label} : refus NOMMÉ, jamais un autre nom couvert`, async () => {
      await expect(
        realCert([{ shortName: "CN", value: "x" }], [dns]),
      ).rejects.toThrow(/SAN/u);
    });
  }

  it("contrôle positif : un dNSName ASCII (joker compris) est couvert tel quel", async () => {
    const cert = await realCert(
      [{ shortName: "CN", value: "x" }],
      ["*.xn--caf-dma.test"],
    );
    expect(parseSubjectAltName(cert.subjectAltName).dns).toEqual([
      "*.xn--caf-dma.test",
    ]);
  });

  it("attribut inconnu ou sans valeur : refus nommé", async () => {
    await expect(
      realCert([{ name: "pwned", value: "x" }], ["x"]),
    ).rejects.toThrow(/inconnu : 'pwned'/u);
    await expect(realCert([{ shortName: "CN" }], ["x"])).rejects.toThrow(
      /sans valeur/u,
    );
  });

  it("OID pointé et emailAddress (IA5String) : relus par Node", async () => {
    const cert = await realCert(
      [
        { type: "2.5.4.3", value: "par-oid" },
        { name: "emailAddress", value: "a@b.test" },
      ],
      ["x"],
    );
    expect(distinguishedNameField(cert.subject, "CN")).toBe("par-oid");
    expect(cert.subject).toContain("a@b.test");
  });
});

describe("red-team x509 — passe 2 : lectures", () => {
  it("SAN : URI, email, entrée sans « : » et citation malformée ne deviennent ni DNS ni IP", () => {
    const san = parseSubjectAltName(
      'URI:https://localhost, email:localhost, localhost, IP Address:127.0.0.1, DNS:"a\\',
    );
    expect(san.dns).toEqual([]);
    expect(san.ip).toEqual(["127.0.0.1"]);
    expect(parseSubjectAltName(undefined)).toEqual({ dns: [], ip: [] });
  });

  it("OID de signature inconnu : rendu tel quel, jamais un nom inventé", () => {
    expect(signatureAlgorithmName("1.2.3.4")).toBe("1.2.3.4");
    expect(signatureAlgorithmName("toString")).toBe("toString");
    expect(signatureAlgorithmName("1.2.840.113549.1.1.11")).toBe(
      "sha256WithRSAEncryption",
    );
  });

  it("DN : clé absente → null", () => {
    expect(distinguishedNameField("CN=a\nO=b", "OU")).toBeNull();
  });
});
