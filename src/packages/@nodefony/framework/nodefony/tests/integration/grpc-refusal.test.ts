/// <reference types="node" />
//
// ─── Refus gRPC au format du protocole (#695, lot 3) ─────────────────────────
//
// Décor : serveur de dev (skill `nodefony-start-server`) — 5151 HTTP/1.1,
// 5152 HTTP/2 + TLS, 5153 h2c. Service gardé `GuardedEchoService`
// (`GrpcGuardedController`) sous les zones `test-grpc-member` (JWT seul) et
// `test-grpc` (JWT puis anonyme, méthode `@IsGranted("ROLE_ADMIN")`).
//
// ADR-0026 D5 (code choisi sur l'IDENTITÉ, message générique), D13 point 1
// (corps non lu), point 2 (forme de chaque protocole, fin du flux portée par
// les en-têtes en HTTP/2) et point 3 (gRPC natif vers une route non gRPC).
// Critères de #695 : 1, 23-26, 52, 55, 56.
//
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import { expect } from "vitest";
import {
  Code,
  ConnectError,
  createClient,
  type Transport,
} from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-node";
import { EchoService } from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/echo_pb.js";
import { GuardedEchoService } from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/guarded_pb.js";
import { IS_PROD_TARGET } from "../../../../http/nodefony/tests/helpers/targetEnv";

const TLS = { rejectUnauthorized: false };
const H1 = "http://127.0.0.1:5151";
const H2_TLS = "https://127.0.0.1:5152";
const H2C = "http://127.0.0.1:5153";
/**
 * HTTP/2 quand le test n'a rien de propre à h2c : h2c n'existe que sur l'app
 * de dev (`servers.h2c`, éteint en production) — TLS prend alors le relais.
 */
const H2 = IS_PROD_TARGET ? H2_TLS : H2C;
const PASSWORD = "secret-de-dev-42";

type ProtocolCase = [string, () => Transport];

const GRPC_H2C: ProtocolCase = [
  "gRPC h2c",
  () => createGrpcTransport({ baseUrl: H2C }),
];

/** Les trois protocoles, sur les ports qui les servent (ADR-0026 D3). */
const PROTOCOLS: ProtocolCase[] = [
  ...(IS_PROD_TARGET ? [] : [GRPC_H2C]),
  [
    "gRPC HTTP/2+TLS",
    () => createGrpcTransport({ baseUrl: H2_TLS, nodeOptions: TLS }),
  ],
  [
    "gRPC-Web HTTP/1.1",
    () => createGrpcWebTransport({ baseUrl: H1, httpVersion: "1.1" }),
  ],
  [
    "Connect HTTP/1.1",
    () => createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
  ],
];

/** Password grant (RFC 6749 §5.1) → jeton d'accès JWT. */
function accessToken(username: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ username, password: PASSWORD }));
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: 5152,
        path: "/nodefony/security/api/token",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
          const token =
            typeof body === "object" && body !== null && "access_token" in body
              ? body.access_token
              : undefined;
          if (typeof token === "string") resolve(token);
          else reject(new Error(`jeton refusé pour ${username}`));
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

/** L'erreur Connect que rend `promise`, ou un échec du test. */
async function connectErrorOf(
  promise: Promise<unknown>,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (e) {
    return ConnectError.from(e);
  }
  throw new Error("l'appel devait échouer");
}

/** Appels servis par le contrôleur gardé : le témoin des refus. */
async function guardedCalls(adminToken: string): Promise<number> {
  const client = createClient(
    GuardedEchoService,
    createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
  );
  const r = await client.member(
    { sentence: "témoin" },
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  return r.calls;
}

/**
 * Appels de `Say` servis sous ce témoin (`x-witness`, `EchoService` hors
 * zone) — propre à chaque test : `grpc.test.ts` appelle `Say` en parallèle.
 */
async function sayCalls(witness: string): Promise<number> {
  const client = createClient(
    EchoService,
    createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
  );
  const r = await client.say(
    { sentence: "témoin" },
    { headers: { "x-witness": witness } },
  );
  return r.calls;
}

/** Le message d'un refus : le nom du code, jamais le texte de l'erreur. */
function expectGenericMessage(err: ConnectError, name: string): void {
  expect(["", name], `message « ${err.rawMessage} »`).to.include(
    err.rawMessage,
  );
}

let adminToken = "";
let userToken = "";

beforeAll(async () => {
  [adminToken, userToken] = await Promise.all([
    accessToken("admin"),
    accessToken("user"),
  ]);
});

describe("gRPC — refus du pare-feu et de @IsGranted : code choisi sur l'IDENTITÉ (D5)", () => {
  for (const [label, transport] of PROTOCOLS) {
    describe(label, () => {
      it("zone JWT, sans jeton : le pare-feu refuse → 16 UNAUTHENTICATED, la méthode n'est PAS appelée", async () => {
        const before = await guardedCalls(adminToken);
        const client = createClient(GuardedEchoService, transport());
        const err = await connectErrorOf(client.member({ sentence: "x" }));
        expect(err.code).to.equal(Code.Unauthenticated);
        expectGenericMessage(err, "unauthenticated");
        expect(await guardedCalls(adminToken)).to.equal(before + 1);
      });

      it("@IsGranted, anonyme → 16 (un anonyme n'est personne)", async () => {
        const client = createClient(GuardedEchoService, transport());
        const err = await connectErrorOf(client.admin({ sentence: "x" }));
        expect(err.code).to.equal(Code.Unauthenticated);
        expectGenericMessage(err, "unauthenticated");
      });

      it("@IsGranted, jeton invalide → 16", async () => {
        const client = createClient(GuardedEchoService, transport());
        const err = await connectErrorOf(
          client.admin(
            { sentence: "x" },
            { headers: { authorization: "Bearer pas.un.jeton" } },
          ),
        );
        expect(err.code).to.equal(Code.Unauthenticated);
      });

      it("@IsGranted, identifié SANS le rôle → 7 PERMISSION_DENIED, la méthode n'est PAS appelée", async () => {
        const before = await guardedCalls(adminToken);
        const client = createClient(GuardedEchoService, transport());
        const err = await connectErrorOf(
          client.admin(
            { sentence: "x" },
            { headers: { authorization: `Bearer ${userToken}` } },
          ),
        );
        expect(err.code).to.equal(Code.PermissionDenied);
        expectGenericMessage(err, "permission_denied");
        expect(await guardedCalls(adminToken)).to.equal(before + 1);
      });

      it("CONTRÔLE POSITIF : identifié AVEC le rôle → servi", async () => {
        const client = createClient(GuardedEchoService, transport());
        const r = await client.admin(
          { sentence: "x" },
          { headers: { authorization: `Bearer ${adminToken}` } },
        );
        expect(r).to.include({ sentence: "x", identifier: "admin" });
      });
    });
  }
});

describe("gRPC — forme Connect d'un refus : statut accordé au code (D13 point 2)", () => {
  it("anonyme refusé par @IsGranted : 401 + Error JSON `unauthenticated`, rien de Nodefony", async () => {
    const r = await fetch(`${H1}/nodefony.test.v1.GuardedEchoService/Admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: '{"sentence":"x"}',
    });
    expect(r.status).to.equal(401);
    expect(r.headers.get("content-type")).to.equal("application/json");
    // Le corps ne nomme ni la zone ni le message de l'erreur.
    expect(await r.json()).to.deep.equal({ code: "unauthenticated" });
  });

  it("chemin inconnu : 404 + `unimplemented`", async () => {
    const r = await fetch(`${H1}/nodefony.test.v1.Nope/Call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: "{}",
    });
    expect(r.status).to.equal(404);
    expect(await r.json()).to.deep.equal({ code: "unimplemented" });
  });

  it("CONTRÔLE : la même 404 en JSON ordinaire garde le rendu de Nodefony", async () => {
    const r = await fetch(`${H1}/nodefony.test.v1.Nope/Call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: "{}",
    });
    expect(r.status).to.equal(404);
    const body: unknown = await r.json();
    expect(body).to.not.deep.equal({ code: "unimplemented" });
  });
});

describe("gRPC — un navigateur d'une autre origine ne forge pas d'appel (critère 24)", () => {
  it("POST Connect `Sec-Fetch-Site: cross-site` → refusé, la méthode n'est PAS appelée", async () => {
    const witness = randomUUID();
    const before = await sayCalls(witness);
    const r = await fetch(`${H1}/nodefony.test.v1.EchoService/Say`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "connect-protocol-version": "1",
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example",
        "x-witness": witness,
      },
      body: '{"sentence":"x"}',
    });
    const body: unknown = await r.json();
    expect(r.status).to.be.oneOf([401, 403]);
    expect(body)
      .to.have.property("code")
      .that.is.oneOf(["unauthenticated", "permission_denied"]);
    expect(await sayCalls(witness)).to.equal(before + 1);
  });
});

interface IRawReply {
  readonly headers: http2.IncomingHttpHeaders;
  /** La trame d'en-têtes de la réponse portait la fin du flux. */
  readonly endStream: boolean;
  readonly trailers: http2.IncomingHttpHeaders | null;
  readonly body: number;
}

/**
 * Un appel HTTP/2 brut : les en-têtes de la réponse, ses drapeaux (fin du
 * flux) et ses trailers. `body` : octets envoyés ; `end` faux = corps jamais
 * fini (le flux reste ouvert côté client).
 */
function rawH2(
  base: string,
  headers: http2.OutgoingHttpHeaders,
  body: Uint8Array = new Uint8Array([0, 0, 0, 0, 0]),
  end: boolean = true,
): Promise<IRawReply> {
  const session = http2.connect(base, TLS);
  return new Promise<IRawReply>((resolve, reject) => {
    session.on("error", reject);
    // `endStream: false` : Node ferme d'office un DELETE sans corps.
    const stream = session.request(
      {
        ":method": "POST",
        "content-type": "application/grpc",
        te: "trailers",
        ...headers,
      },
      { endStream: false },
    );
    let response: http2.IncomingHttpHeaders = {};
    let endStream = false;
    let trailers: http2.IncomingHttpHeaders | null = null;
    let received = 0;
    stream.on("response", (h, flags) => {
      response = h;
      endStream = (flags & http2.constants.NGHTTP2_FLAG_END_STREAM) !== 0;
      // Corps jamais fini : la réponse suffit, le flux est rendu.
      if (!end) resolve({ headers: response, endStream, trailers, body: 0 });
    });
    stream.on("trailers", (t) => (trailers = t));
    stream.on("data", (c: Buffer) => (received += c.byteLength));
    stream.on("end", () =>
      resolve({ headers: response, endStream, trailers, body: received }),
    );
    stream.on("error", reject);
    if (end) stream.end(body);
    else stream.write(body);
  }).finally(() => session.close());
}

describe("gRPC natif — forme d'un refus de transport : Trailers-Only (D13 point 2)", () => {
  it("chemin inconnu → 200, grpc-status 12 dans les EN-TÊTES, fin du flux sur leur trame, ni corps ni trailers", async () => {
    const r = await rawH2(H2, { ":path": "/nodefony.test.v1.Nope/Call" });
    expect(r.headers[":status"]).to.equal(200);
    expect(r.headers["content-type"]).to.equal("application/grpc");
    expect(r.headers["grpc-status"]).to.equal("12");
    expect(r.headers["grpc-message"]).to.equal("unimplemented");
    expect(r.endStream, "END_STREAM sur la trame d'en-têtes").to.equal(true);
    expect(r.trailers).to.equal(null);
    expect(r.body).to.equal(0);
  });

  it("idem en HTTP/2+TLS (5152)", async () => {
    const r = await rawH2(H2_TLS, { ":path": "/nodefony.test.v1.Nope/Call" });
    expect(r.headers["grpc-status"]).to.equal("12");
    expect(r.endStream).to.equal(true);
  });

  it("405 (méthode HTTP refusée) → 12, table des refus de transport (critère 56)", async () => {
    const r = await rawH2(H2, {
      ":method": "DELETE",
      ":path": "/nodefony.test.v1.EchoService/Say",
    });
    expect(r.headers[":status"]).to.equal(200);
    expect(r.headers["grpc-status"]).to.equal("12");
  });

  it("421 (hôte non servi) → 14 UNAVAILABLE : le client réessaie ailleurs (critère 56)", async () => {
    const r = await rawH2(H2, {
      ":path": "/nodefony.test.v1.EchoService/Say",
      ":authority": "evil.example",
    });
    expect(r.headers[":status"]).to.equal(200);
    expect(r.headers["grpc-status"]).to.equal("14");
  });

  it("casse modifiée (repli de l'adaptateur) → même forme, 12", async () => {
    const r = await rawH2(H2, {
      ":path": "/nodefony.test.v1.echoservice/say",
    });
    expect(r.headers["grpc-status"]).to.equal("12");
    expect(r.endStream).to.equal(true);
  });

  it("CONTRÔLE : un appel servi garde son statut dans les TRAILERS", async () => {
    const r = await rawH2(H2, {
      ":path": "/nodefony.test.v1.EchoService/Ping",
    });
    expect(r.headers["grpc-status"]).to.equal(undefined);
    expect(r.endStream).to.equal(false);
    expect(r.trailers?.["grpc-status"]).to.equal("0");
  });
});

describe("gRPC natif vers une route qui n'est pas gRPC (attrape-tout) → 12 (critère 55)", () => {
  const CATCH_ALL = "/nodefony/test/route/nodefony.test.v1.Nope/Call";

  it("gRPC natif sur l'attrape-tout : refusé en 12, jamais la page", async () => {
    const r = await rawH2(H2, { ":path": CATCH_ALL });
    expect(r.headers[":status"]).to.equal(200);
    expect(r.headers["grpc-status"]).to.equal("12");
    expect(r.body).to.equal(0);
  });

  it("CONTRÔLE : le même chemin en JSON est servi par l'attrape-tout", async () => {
    const r = await fetch(`${H1}${CATCH_ALL}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await r.arrayBuffer();
    expect(r.status).to.equal(200);
  });
});

describe("gRPC — corps non lu d'un refus (D13 point 1, critère 26)", () => {
  it("HTTP/2 : le refus arrive alors que le corps n'est PAS fini", async () => {
    const r = await rawH2(
      H2,
      { ":path": "/nodefony.test.v1.Nope/Call" },
      new Uint8Array([0, 0, 0, 0, 9, 1, 2, 3]),
      false,
    );
    expect(r.headers["grpc-status"]).to.equal("12");
  });

  it("HTTP/2 : un client qui émet sans jamais finir voit son flux fermé (NO_ERROR) après la réponse", async () => {
    const session = http2.connect(H2, TLS);
    try {
      const closed = await new Promise<number>((resolve, reject) => {
        const stream = session.request({
          ":method": "POST",
          ":path": "/nodefony.test.v1.Nope/Call",
          "content-type": "application/grpc",
          te: "trailers",
        });
        stream.on("error", () => undefined);
        stream.on("close", () => resolve(stream.rstCode));
        stream.on("response", () => {
          // Le client continue d'émettre, sans jamais finir.
          const chunk = new Uint8Array(64 * 1024);
          for (let i = 0; i < 6; i++) stream.write(chunk);
        });
        stream.resume();
        session.on("error", reject);
      });
      expect(closed).to.equal(http2.constants.NGHTTP2_NO_ERROR);
    } finally {
      session.close();
    }
  });

  it("HTTP/1.1 gRPC-Web : 1 Mio vers un chemin inconnu → refus + `connection: close`", async () => {
    const body = new Uint8Array(1024 * 1024);
    const reply = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        `${H1}/nodefony.test.v1.Nope/Call`,
        {
          method: "POST",
          headers: {
            "content-type": "application/grpc-web+proto",
            "content-length": String(body.byteLength),
          },
        },
        resolve,
      );
      req.on("error", reject);
      req.end(body);
    });
    reply.resume();
    expect(reply.statusCode).to.equal(200);
    expect(reply.headers["grpc-status"]).to.equal("12");
    expect(reply.headers.connection).to.equal("close");
  });

  it("HTTP/1.1 gRPC-Web : corps JAMAIS fini vers un chemin inconnu → refus aussitôt, socket fermée par le serveur sans attendre requestTimeout", async () => {
    // Content-Length de 1 Mio, cinq octets envoyés, puis plus rien : le
    // serveur ne doit ni attendre la fin du corps pour refuser, ni garder la
    // socket jusqu'à `requestTimeout` (30 s par défaut).
    const out = await new Promise<{ head: string; closed: boolean }>(
      (resolve, reject) => {
        let head = "";
        const socket = net.connect(5151, "127.0.0.1");
        const cap = setTimeout(() => {
          socket.destroy();
          resolve({ head, closed: false });
        }, 10_000);
        socket.on("data", (c: Buffer) => {
          if (head === "")
            head = c.toString("latin1").split("\r\n\r\n")[0] ?? "";
        });
        socket.on("close", () => {
          clearTimeout(cap);
          resolve({ head, closed: true });
        });
        socket.on("error", reject);
        socket.write(
          "POST /nodefony.test.v1.Nope/Call HTTP/1.1\r\nHost: 127.0.0.1:5151\r\n" +
            "Content-Type: application/grpc-web+proto\r\nContent-Length: 1048576\r\n\r\n",
        );
        socket.write(new Uint8Array([0, 0, 0, 0, 9]));
      },
    );
    expect(out.head).to.match(/^HTTP\/1\.1 200 /);
    expect(out.head).to.match(/\r\ngrpc-status: 12\r\n/);
    expect(out.head).to.match(/\r\nconnection: close\r\n/i);
    expect(out.closed, "socket encore ouverte au plafond de 10 s").to.equal(
      true,
    );
  });
});
