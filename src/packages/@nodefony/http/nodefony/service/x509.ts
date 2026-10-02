/**
 * Fabrique et lecture de certificats X.509 par `node:crypto` seul — aucune
 * dépendance tierce.
 *
 * `node:crypto` sait LIRE un certificat (`X509Certificate`) et SIGNER, pas
 * en FABRIQUER un : ce module encode le `TBSCertificate` en DER (RFC 5280
 * §4.1), le signe avec `crypto.sign`, puis l'assemble. Seul le sous-ensemble
 * nécessaire à un certificat serveur auto-signé est couvert. Les fonctions
 * sont PURES (aucun disque, aucun kernel) : elles s'éprouvent sans décor.
 *
 * Pourquoi pas node-forge : sa vérification de signature RSA PKCS#1 v1.5
 * accepte des signatures forgées (GHSA-86w9-cpqp-85rv), sans aucune version
 * corrigée. Nous ne vérifions aucune signature, mais `npm audit` signale le
 * paquet pour tous ceux qui installent `@nodefony/http`.
 */
import { createHash, sign, type KeyObject } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/** Hachages de signature que le builder sait déclarer. */
export type X509Hash = "sha1" | "sha256" | "sha384" | "sha512";

/**
 * Attribut d'un nom distinctif (sujet / émetteur). Forme reprise de la config
 * historique : `name` long (`commonName`), `shortName` (`CN`) ou `type` (OID
 * pointé) — le premier présent fait foi.
 */
export interface ICertificateAttribute {
  name?: string | undefined;
  shortName?: string | undefined;
  type?: string | undefined;
  value?: string | undefined;
}

/** Ce qu'il faut pour fabriquer un certificat serveur auto-signé. */
export interface ISelfSignedSpec {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Numéro de série en hexadécimal (entier positif, RFC 5280 §4.1.2.2). */
  serialHex: string;
  notBefore: Date;
  notAfter: Date;
  /** Sujet ET émetteur (auto-signé). Vide = nom vide, SAN alors critique. */
  attributes: ICertificateAttribute[];
  dns: string[];
  ip: string[];
  /** `sha1` n'est accepté que pour fabriquer des témoins de test. */
  hash: X509Hash;
}

// ── OID ────────────────────────────────────────────────────────────────────

const SIGNATURE_OIDS: Record<X509Hash, string> = {
  sha1: "1.2.840.113549.1.1.5",
  sha256: "1.2.840.113549.1.1.11",
  sha384: "1.2.840.113549.1.1.12",
  sha512: "1.2.840.113549.1.1.13",
};

/** OID de la signature RSA-SHA1, que le service régénère. */
export const SHA1_WITH_RSA_OID = SIGNATURE_OIDS.sha1;

/** Noms lisibles des algorithmes de signature courants (rendu de `describe`). */
const SIGNATURE_NAMES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    [SIGNATURE_OIDS.sha1]: "sha1WithRSAEncryption",
    [SIGNATURE_OIDS.sha256]: "sha256WithRSAEncryption",
    [SIGNATURE_OIDS.sha384]: "sha384WithRSAEncryption",
    [SIGNATURE_OIDS.sha512]: "sha512WithRSAEncryption",
    "1.2.840.113549.1.1.10": "RSASSA-PSS",
    "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
    "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
    "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
    "1.3.101.112": "Ed25519",
  },
);

const ATTRIBUTE_OIDS: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    commonName: "2.5.4.3",
    CN: "2.5.4.3",
    surname: "2.5.4.4",
    SN: "2.5.4.4",
    serialNumber: "2.5.4.5",
    countryName: "2.5.4.6",
    C: "2.5.4.6",
    localityName: "2.5.4.7",
    L: "2.5.4.7",
    stateOrProvinceName: "2.5.4.8",
    ST: "2.5.4.8",
    streetAddress: "2.5.4.9",
    street: "2.5.4.9",
    organizationName: "2.5.4.10",
    O: "2.5.4.10",
    organizationalUnitName: "2.5.4.11",
    OU: "2.5.4.11",
    title: "2.5.4.12",
    givenName: "2.5.4.42",
    emailAddress: "1.2.840.113549.1.9.1",
    E: "1.2.840.113549.1.9.1",
  },
);

const OID_COUNTRY = "2.5.4.6";
const OID_EMAIL = "1.2.840.113549.1.9.1";

const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";
const OID_SUBJECT_KEY_ID = "2.5.29.14";
const OID_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const OID_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";

// ── Encodage DER (X.690) ───────────────────────────────────────────────────

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

const sequence = (...items: Buffer[]): Buffer =>
  tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
const explicit = (n: number, content: Buffer): Buffer => tlv(0xa0 | n, content);
const octetString = (content: Buffer): Buffer => tlv(0x04, content);
const bitString = (content: Buffer): Buffer =>
  tlv(0x03, Buffer.concat([Buffer.from([0x00]), content]));
const DER_NULL = Buffer.from([0x05, 0x00]);
const DER_TRUE = tlv(0x01, Buffer.from([0xff]));

function objectIdentifier(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  const [first = 0, second = 0, ...rest] = arcs;
  const bytes: number[] = [first * 40 + second];
  for (const arc of rest) {
    const chunk: number[] = [arc & 0x7f];
    for (
      let value = Math.floor(arc / 128);
      value > 0;
      value = Math.floor(value / 128)
    ) {
      chunk.unshift((value & 0x7f) | 0x80);
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** Entier positif depuis sa forme hexadécimale (octet 0x00 ajouté si besoin). */
function positiveInteger(hex: string): Buffer {
  let bytes = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, "hex");
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  bytes = bytes.subarray(start);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if ((bytes[0] ?? 0) & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

/** RFC 5280 §4.1.2.5 : UTCTime jusqu'en 2049, GeneralizedTime au-delà. */
function time(date: Date): Buffer {
  const iso = date.toISOString(); // AAAA-MM-JJTHH:MM:SS.sssZ
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  const year = date.getUTCFullYear();
  if (year >= 1950 && year < 2050) {
    return tlv(0x17, Buffer.from(digits.slice(2), "ascii"));
  }
  return tlv(0x18, Buffer.from(digits, "ascii"));
}

function attributeOid(attribute: ICertificateAttribute): string {
  if (attribute.type && /^\d+(\.\d+)+$/.test(attribute.type)) {
    return attribute.type;
  }
  const key = attribute.name ?? attribute.shortName ?? attribute.type ?? "";
  const oid = ATTRIBUTE_OIDS[key];
  if (!oid) {
    throw new Error(
      `Attribut de certificat inconnu : '${key}'. Noms reconnus : ${Object.keys(ATTRIBUTE_OIDS).join(", ")}.`,
    );
  }
  return oid;
}

/** Nom distinctif : un RDN par attribut (RFC 5280 §4.1.2.4). */
function distinguishedName(attributes: ICertificateAttribute[]): Buffer {
  const rdns = attributes.map((attribute) => {
    const oid = attributeOid(attribute);
    if (typeof attribute.value !== "string") {
      throw new Error(`Attribut de certificat '${oid}' sans valeur.`);
    }
    const value = Buffer.from(attribute.value, "utf8");
    // countryName est un PrintableString, emailAddress un IA5String (RFC 5280
    // annexe A) ; le reste en UTF8String (RFC 5280 §4.1.2.6).
    const tag = oid === OID_COUNTRY ? 0x13 : oid === OID_EMAIL ? 0x16 : 0x0c;
    return set(sequence(objectIdentifier(oid), tlv(tag, value)));
  });
  return sequence(...rdns);
}

/** Octets d'une adresse IP pour un SAN `iPAddress` (4 ou 16 octets). */
export function ipAddressBytes(ip: string): Buffer {
  if (isIPv4(ip)) {
    return Buffer.from(ip.split(".").map(Number));
  }
  if (!isIPv6(ip) || ip.includes("%")) {
    throw new Error(`Adresse IP invalide pour un SAN : '${ip}'.`);
  }
  const toGroups = (part: string): number[] => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const [a = 0, b = 0, c = 0, d = 0] = piece.split(".").map(Number);
        groups.push((a << 8) | b, (c << 8) | d);
      } else {
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const [head = "", tail] = ip.split("::");
  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  const out = Buffer.alloc(16);
  [...left, ...zeros, ...right].forEach((group, i) =>
    out.writeUInt16BE(group, i * 2),
  );
  return out;
}

function extension(oid: string, critical: boolean, value: Buffer): Buffer {
  return critical
    ? sequence(objectIdentifier(oid), DER_TRUE, octetString(value))
    : sequence(objectIdentifier(oid), octetString(value));
}

// ── Lecture DER minimale ───────────────────────────────────────────────────

interface IDerNode {
  tag: number;
  /** Début du contenu. */
  start: number;
  /** Fin du contenu (exclue). */
  end: number;
}

function readNode(der: Buffer, offset: number): IDerNode {
  const tag = der[offset];
  let length = der[offset + 1];
  if (tag === undefined || length === undefined) {
    throw new Error("DER tronqué.");
  }
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) {
      length = length * 256 + (der[start + i] ?? 0);
    }
    start += count;
  }
  const end = start + length;
  if (end > der.length) {
    throw new Error("DER tronqué.");
  }
  return { tag, start, end };
}

function children(der: Buffer, node: IDerNode): IDerNode[] {
  const out: IDerNode[] = [];
  for (let offset = node.start; offset < node.end;) {
    const child = readNode(der, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

function decodeObjectIdentifier(bytes: Buffer): string {
  const first = bytes[0] ?? 0;
  const arcs = [
    Math.min(Math.floor(first / 40), 2),
    first - Math.min(Math.floor(first / 40), 2) * 40,
  ];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join(".");
}

/**
 * OID de l'algorithme de signature d'un certificat DER (champ
 * `signatureAlgorithm`, RFC 5280 §4.1.1.2). Lu dans le DER plutôt que par
 * `X509Certificate.signatureAlgorithmOid`, absent des Node du plancher.
 *
 * @param der - certificat encodé DER (`X509Certificate.raw`)
 * @throws Si le DER n'a pas la forme d'un certificat
 */
export function signatureAlgorithmOid(der: Buffer): string {
  const [, algorithm] = children(der, readNode(der, 0));
  const oid = algorithm ? children(der, algorithm)[0] : undefined;
  if (oid?.tag !== 0x06) {
    throw new Error("Certificat DER sans algorithme de signature.");
  }
  return decodeObjectIdentifier(der.subarray(oid.start, oid.end));
}

/** Nom lisible d'un OID de signature (l'OID lui-même s'il est inconnu). */
export function signatureAlgorithmName(oid: string): string {
  return SIGNATURE_NAMES[oid] ?? oid;
}

/**
 * Entrées DNS et IP d'un `subjectAltName` tel que le rend
 * `X509Certificate.subjectAltName` (`DNS:a, IP Address:1.2.3.4`).
 */
export function parseSubjectAltName(value: string | undefined): {
  dns: string[];
  ip: string[];
} {
  const dns: string[] = [];
  const ip: string[] = [];
  if (!value) return { dns, ip };
  for (const raw of value.split(/,\s*/)) {
    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    const kind = raw.slice(0, colon);
    let entry = raw.slice(colon + 1);
    // Node cite en JSON une valeur qui contient un séparateur.
    if (entry.startsWith('"')) {
      try {
        entry = String(JSON.parse(entry));
      } catch {
        continue;
      }
    }
    if (kind === "DNS") dns.push(entry);
    else if (kind === "IP Address") ip.push(entry);
  }
  return { dns, ip };
}

/**
 * Valeur d'un champ d'un nom distinctif tel que le rend
 * `X509Certificate.subject` / `.issuer` (une ligne `CLÉ=valeur` par champ).
 */
export function distinguishedNameField(dn: string, key: string): string | null {
  for (const line of dn.split("\n")) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return null;
}

// ── Fabrication ────────────────────────────────────────────────────────────

/** Contenu de la BIT STRING `subjectPublicKey` d'une SPKI DER. */
function subjectPublicKeyBits(spki: Buffer): Buffer {
  const [, key] = children(spki, readNode(spki, 0));
  if (key?.tag !== 0x03) {
    throw new Error("Clé publique SPKI sans subjectPublicKey.");
  }
  // Premier octet = nombre de bits inutilisés, hors du hachage (RFC 5280 §4.2.1.2).
  return spki.subarray(key.start + 1, key.end);
}

function signAsync(
  hash: X509Hash,
  data: Buffer,
  key: KeyObject,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sign(hash, data, key, (error, signature) => {
      if (error) reject(error);
      else resolve(signature);
    });
  });
}

function toPem(der: Buffer): string {
  const base64 = der
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .replace(/\n$/, "");
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Fabrique un certificat serveur auto-signé et le rend en PEM.
 *
 * Contenu : version 3, sujet = émetteur, `basicConstraints` cA=false,
 * `keyUsage` (digitalSignature, keyEncipherment — critique),
 * `extKeyUsage` (serverAuth, clientAuth), `subjectAltName` (critique si le
 * sujet est vide, RFC 5280 §4.2.1.6) et `subjectKeyIdentifier` (SHA-1 de la
 * clé publique, méthode 1 de RFC 5280 §4.2.1.2).
 *
 * @param spec - clés, série, validité, noms et hachage
 * @returns le certificat encodé PEM
 * @throws Si un attribut ou une adresse IP est invalide
 */
export async function createSelfSignedCertificate(
  spec: ISelfSignedSpec,
): Promise<string> {
  const spki = spec.publicKey.export({ type: "spki", format: "der" });
  const algorithm = sequence(
    objectIdentifier(SIGNATURE_OIDS[spec.hash]),
    DER_NULL,
  );
  const name = distinguishedName(spec.attributes);

  const altNames = [
    ...spec.dns.map((dns) => tlv(0x82, Buffer.from(dns, "ascii"))),
    ...spec.ip.map((ip) => tlv(0x87, ipAddressBytes(ip))),
  ];
  const extensions: Buffer[] = [
    extension(OID_BASIC_CONSTRAINTS, false, sequence()),
    // digitalSignature (bit 0) + keyEncipherment (bit 2) : 1010 0000, 5 bits inutilisés.
    extension(OID_KEY_USAGE, true, tlv(0x03, Buffer.from([0x05, 0xa0]))),
    extension(
      OID_EXT_KEY_USAGE,
      false,
      sequence(
        objectIdentifier(OID_SERVER_AUTH),
        objectIdentifier(OID_CLIENT_AUTH),
      ),
    ),
  ];
  if (altNames.length > 0) {
    extensions.push(
      extension(
        OID_SUBJECT_ALT_NAME,
        spec.attributes.length === 0,
        sequence(...altNames),
      ),
    );
  }
  extensions.push(
    extension(
      OID_SUBJECT_KEY_ID,
      false,
      octetString(
        createHash("sha1").update(subjectPublicKeyBits(spki)).digest(),
      ),
    ),
  );

  const tbs = sequence(
    explicit(0, tlv(0x02, Buffer.from([2]))), // v3
    positiveInteger(spec.serialHex),
    algorithm,
    name,
    sequence(time(spec.notBefore), time(spec.notAfter)),
    name,
    spki,
    explicit(3, sequence(...extensions)),
  );
  const signature = await signAsync(spec.hash, tbs, spec.privateKey);
  return toPem(sequence(tbs, algorithm, bitString(signature)));
}
