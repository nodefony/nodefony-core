/// <reference types="node" />
/**
 * Integration — la cérémonie WebAuthn ENTIÈRE, par les vraies routes, jouée par
 * un authentificateur LOGICIEL.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * 🔴 POURQUOI CE FICHIER EXISTE. Le store de passkeys était éprouvé sur chaque
 * backend, la cérémonie jamais : aucun banc ne fabriquait d'attestation, donc
 * rien ne prouvait qu'un enrôlement réel aboutit, qu'une connexion par passkey
 * ouvre une session, ni que les refus (rejeu, clone, clé étrangère, origine
 * étrangère) tiennent de bout en bout — contrôleur, session, service, store.
 *
 * L'authentificateur est une clé P-256 de `node:crypto` ; il produit ce qu'un
 * navigateur transmet : `clientDataJSON`, une attestation `none` encodée en
 * CBOR, puis des assertions signées ECDSA-SHA256 sur `authData ‖
 * SHA-256(clientDataJSON)`. La vérification cryptographique est celle du
 * serveur, sans aucun raccourci.
 *
 * Ils tournent sous les DEUX passes — même serveur, base différente :
 * `npm run test:all` (Drizzle) et `npm run test:all -- --mongo`.
 */
import { beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import https from "node:https";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

// rpID vaut `localhost` en développement (une IP n'est pas un rpID valide) :
// on parle au serveur sous ce nom, avec l'origine qu'un navigateur enverrait.
const HOST = "localhost:5152";
const ORIGIN = `https://${HOST}`;
const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const ME = "/nodefony/security/api/auth/me";
const WA = "/nodefony/security/api/webauthn";
const TIMEOUT = 15_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = {
      host: HOST,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut / vide */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function cookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

const post = (p: string, cookie?: string, body?: unknown, extra = {}) =>
  request("POST", p, { ...(cookie ? { cookie } : {}), ...extra }, body);
const get = (p: string, cookie?: string) =>
  request("GET", p, cookie ? { cookie } : {});

// ── CBOR minimal (RFC 8949) : ce qu'une attestation `none` contient ─────────

function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

type Cbor = number | string | Buffer | Map<Cbor, Cbor>;

function cbor(v: Cbor): Buffer {
  if (typeof v === "number") {
    return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  }
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([cborHead(3, b.length), b]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
  const parts: Buffer[] = [cborHead(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

// ── Authentificateur logiciel ────────────────────────────────────────────────

const b64u = (b: Buffer): string => b.toString("base64url");
const sha256 = (b: Buffer | string): Buffer =>
  createHash("sha256").update(b).digest();

const FLAG_UP = 0x01; // présence de l'utilisateur
const FLAG_UV = 0x04; // vérification de l'utilisateur
const FLAG_AT = 0x40; // données de credential attestées

class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  readonly #privateKey: KeyObject;
  readonly #publicJwk: { x: string; y: string };
  counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    this.#privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    this.#publicJwk = jwk;
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  /** Clé publique COSE (EC2, ES256) — RFC 9053 §7.1.1. */
  #cosePublicKey(): Buffer {
    return cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.#publicJwk.x, "base64url")],
        [-3, Buffer.from(this.#publicJwk.y, "base64url")],
      ]),
    );
  }

  #authData(rpId: string, flags: number, attested: boolean): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter, 0);
    const parts = [sha256(rpId), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length, 0);
      parts.push(
        Buffer.alloc(16), // AAGUID nul : authentificateur anonyme
        len,
        this.credentialId,
        this.#cosePublicKey(),
      );
    }
    return Buffer.concat(parts);
  }

  /** Réponse d'ENRÔLEMENT (`navigator.credentials.create`). */
  attest(challenge: string, rpId: string, origin = ORIGIN): unknown {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge, origin }),
    );
    const authData = this.#authData(rpId, FLAG_UP | FLAG_UV | FLAG_AT, true);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /**
   * Réponse d'AUTHENTIFICATION (`navigator.credentials.get`). `signWith`
   * permet de signer avec une AUTRE clé — pour éprouver le refus.
   */
  assert(
    challenge: string,
    rpId: string,
    opts: { origin?: string; signWith?: KeyObject; userHandle?: string } = {},
  ): unknown {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: opts.origin ?? ORIGIN,
      }),
    );
    const authData = this.#authData(rpId, FLAG_UP | FLAG_UV, false);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      opts.signWith ?? this.#privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        ...(opts.userHandle ? { userHandle: opts.userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}

type Options = { challenge: string; rp?: { id?: string }; rpId?: string };

/** Ouvre une cérémonie de connexion ANONYME : défi + cookie qui le porte. */
async function loginOptions(): Promise<{ options: Options; cookie: string }> {
  const res = await post(`${WA}/login/options`);
  expect(res.status, JSON.stringify(res.body)).to.equal(200);
  const cookie = cookieOf(res);
  expect(cookie, "le défi est porté par une session").to.be.a("string");
  return { options: res.body as Options, cookie: cookie! };
}

describe("WebAuthn — la cérémonie ENTIÈRE, par un authentificateur logiciel", () => {
  let admin = "";
  let rpId = "";
  const device = new SoftAuthenticator();

  beforeAll(async () => {
    const res = await post(LOGIN, undefined, {
      username: "admin",
      password: "secret-de-dev-42",
    });
    expect(res.status, `login : ${JSON.stringify(res.body)}`).to.equal(200);
    admin = cookieOf(res)!;
  });

  afterAll(async () => {
    // Le décor se rend comme on l'a trouvé : une passkey laissée sur le compte
    // d'administration fausserait le plafond d'enrôlement des passes suivantes.
    if (admin) {
      await request("DELETE", `${WA}/credentials/${device.id}`, {
        cookie: admin,
      });
    }
  });

  it("refuse l'enrôlement anonyme", async () => {
    const res = await post(`${WA}/register/options`);
    // 401 attendu ; un 404 ou un 503 dirait que la brique n'est pas montée,
    // ce qui rendrait tout le reste de ce fichier vert sans rien exercer.
    expect(res.status, JSON.stringify(res.body)).to.equal(401);
  });

  it("enrôle une passkey : attestation vérifiée, credential persisté", async () => {
    const opts = await post(`${WA}/register/options`, admin);
    expect(opts.status, JSON.stringify(opts.body)).to.equal(200);
    const options = opts.body as Options;
    rpId = options.rp?.id ?? "";
    expect(rpId, "le serveur annonce son rpID").to.equal("localhost");

    const res = await post(`${WA}/register/verify`, admin, {
      response: device.attest(options.challenge, rpId),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body).to.deep.include({
      verified: true,
      credentialId: device.id,
    });

    const list = await get(`${WA}/credentials`, admin);
    expect(list.status).to.equal(200);
    const ids = (
      list.body as { credentials: { id: string }[] }
    ).credentials.map((c) => c.id);
    expect(ids, "la passkey est rattachée à CE compte").to.include(device.id);
  });

  it("refuse le rejeu d'une attestation : le défi est à usage unique", async () => {
    const opts = await post(`${WA}/register/options`, admin);
    const options = opts.body as Options;
    const response = device.attest(options.challenge, rpId);
    const first = await post(`${WA}/register/verify`, admin, { response });
    // Même credential : le serveur peut l'accepter (réenregistrement) ou le
    // refuser — ce cas n'éprouve que le défi, consommé au premier passage.
    expect([200, 401, 409]).to.include(first.status);
    const replay = await post(`${WA}/register/verify`, admin, { response });
    expect(replay.status, JSON.stringify(replay.body)).to.equal(400);
    expect(replay.body).to.deep.equal({ error: "No challenge" });
  });

  it("connecte par passkey un appelant ANONYME et lui ouvre une session", async () => {
    const { options, cookie } = await loginOptions();
    device.counter = 1;
    const res = await post(`${WA}/login/verify`, cookie, {
      response: device.assert(options.challenge, rpId),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect((res.body as { verified?: boolean }).verified).to.equal(true);

    // La session est RÉELLEMENT authentifiée : le serveur la relit.
    const session = cookieOf(res) ?? cookie;
    const me = await get(ME, session);
    expect(me.status, JSON.stringify(me.body)).to.equal(200);
    expect(JSON.stringify(me.body)).to.include("admin");
  });

  it("refuse le rejeu d'une assertion : le défi est consommé", async () => {
    const { options, cookie } = await loginOptions();
    device.counter = 2;
    const response = device.assert(options.challenge, rpId);
    const first = await post(`${WA}/login/verify`, cookie, { response });
    expect(first.status, JSON.stringify(first.body)).to.equal(200);
    const replay = await post(`${WA}/login/verify`, cookie, { response });
    expect(replay.status, JSON.stringify(replay.body)).to.equal(400);
  });

  it("refuse un compteur qui RECULE : signe d'un authentificateur cloné", async () => {
    const { options, cookie } = await loginOptions();
    device.counter = 1; // le serveur a déjà vu 2
    const res = await post(`${WA}/login/verify`, cookie, {
      response: device.assert(options.challenge, rpId),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(401);
    expect(res.body).to.deep.equal({ error: "WebAuthn verification failed" });

    // TÉMOIN : la même assertion avec un compteur qui AVANCE passe — le refus
    // ci-dessus tient donc au compteur, et à rien d'autre.
    const again = await loginOptions();
    device.counter = 3;
    const ok = await post(`${WA}/login/verify`, again.cookie, {
      response: device.assert(again.options.challenge, rpId),
    });
    expect(ok.status, JSON.stringify(ok.body)).to.equal(200);
  });

  it("refuse une assertion signée par une AUTRE clé", async () => {
    const { options, cookie } = await loginOptions();
    device.counter = 10;
    const intruder = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const res = await post(`${WA}/login/verify`, cookie, {
      response: device.assert(options.challenge, rpId, {
        signWith: intruder.privateKey,
      }),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(401);
  });

  it("refuse une assertion émise pour une AUTRE origine (hameçonnage)", async () => {
    const { options, cookie } = await loginOptions();
    device.counter = 11;
    const res = await post(`${WA}/login/verify`, cookie, {
      response: device.assert(options.challenge, rpId, {
        origin: "https://localhost.evil.example",
      }),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(401);
  });

  it("une passkey SUPPRIMÉE n'ouvre plus rien", async () => {
    const removed = await request("DELETE", `${WA}/credentials/${device.id}`, {
      cookie: admin,
    });
    expect(removed.status, JSON.stringify(removed.body)).to.equal(200);

    const { options, cookie } = await loginOptions();
    device.counter = 12;
    const res = await post(`${WA}/login/verify`, cookie, {
      response: device.assert(options.challenge, rpId),
    });
    expect(res.status, JSON.stringify(res.body)).to.equal(401);
  });
});
