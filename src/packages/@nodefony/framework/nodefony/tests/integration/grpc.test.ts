/// <reference types="node" />
//
// ─── gRPC servi par le pipeline : déclarer et servir (#695, lot 2) ───────────
//
// Décor : serveur de dev (skill `nodefony-start-server`) — 5151 HTTP/1.1,
// 5152 HTTP/2 + TLS, 5153 h2c (activé en développement). Contrats :
// `src/modules/test/proto/`, contrôleurs `GrpcEchoController` (singleton) et
// `GrpcScopedEchoController` (`@Scope("request")`). Clients : les transports
// RÉELS de `@connectrpc/connect-node`.
//
// Critères de #695 : 2 (casse → 12, méthode non appelée), 4 (GET refusé hors
// NO_SIDE_EFFECTS), 6 (singleton / par appel), 13 (matrice ADR-0026 D3),
// 14 (formulaire, texte, urlencoded → 415, méthode non appelée), 15 (gRPC natif
// vers 5151 : échec franc avant l'échéance).
//
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  create,
  createRegistry,
  equals,
  type DescMethodUnary,
} from "@bufbuild/protobuf";
import { anyPack, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  type Client,
  type Transport,
} from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-node";
import {
  EchoService,
  ScopedEchoService,
} from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/echo_pb.js";
import {
  Complex_Level,
  ComplexSchema,
  TreeSchema,
  type Complex,
} from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/complex_pb.js";
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
// `Any` en JSON exige de connaître le type emballé, des deux côtés.
const registry = createRegistry(TreeSchema, ComplexSchema);

type Protocol = "grpc" | "grpc-web" | "connect";
interface ICase {
  label: string;
  protocol: Protocol;
  transport: (binary: boolean) => Transport;
}

/** Lignes h2c de la matrice : app de dev seulement (cf `H2`). */
const H2C_SERVED: ICase[] = [
  {
    label: "5153 h2c gRPC",
    protocol: "grpc",
    transport: () => createGrpcTransport({ baseUrl: H2C }),
  },
  {
    label: "5153 h2c gRPC-Web",
    protocol: "grpc-web",
    transport: (binary) =>
      createGrpcWebTransport({
        baseUrl: H2C,
        httpVersion: "2",
        useBinaryFormat: binary,
        jsonOptions: { registry },
      }),
  },
  {
    label: "5153 h2c Connect",
    protocol: "connect",
    transport: (binary) =>
      createConnectTransport({
        baseUrl: H2C,
        httpVersion: "2",
        useBinaryFormat: binary,
        jsonOptions: { registry },
      }),
  },
];

/** La matrice servie d'ADR-0026 D3 (`connect-node-server-plugins.md`). */
const SERVED: ICase[] = [
  {
    label: "5152 HTTP/2+TLS gRPC",
    protocol: "grpc",
    transport: () => createGrpcTransport({ baseUrl: H2_TLS, nodeOptions: TLS }),
  },
  {
    label: "5152 HTTP/2+TLS gRPC-Web",
    protocol: "grpc-web",
    transport: (binary) =>
      createGrpcWebTransport({
        baseUrl: H2_TLS,
        httpVersion: "2",
        useBinaryFormat: binary,
        jsonOptions: { registry },
        nodeOptions: TLS,
      }),
  },
  {
    label: "5152 HTTP/2+TLS Connect",
    protocol: "connect",
    transport: (binary) =>
      createConnectTransport({
        baseUrl: H2_TLS,
        httpVersion: "2",
        useBinaryFormat: binary,
        jsonOptions: { registry },
        nodeOptions: TLS,
      }),
  },
  {
    label: "5152 HTTP/1.1+TLS Connect (navigateur)",
    protocol: "connect",
    transport: (binary) =>
      createConnectTransport({
        baseUrl: H2_TLS,
        httpVersion: "1.1",
        useBinaryFormat: binary,
        jsonOptions: { registry },
        nodeOptions: TLS,
      }),
  },
  ...(IS_PROD_TARGET ? [] : H2C_SERVED),
  {
    label: "5151 HTTP/1.1 gRPC-Web",
    protocol: "grpc-web",
    transport: (binary) =>
      createGrpcWebTransport({
        baseUrl: H1,
        httpVersion: "1.1",
        useBinaryFormat: binary,
        jsonOptions: { registry },
      }),
  },
  {
    label: "5151 HTTP/1.1 Connect",
    protocol: "connect",
    transport: (binary) =>
      createConnectTransport({
        baseUrl: H1,
        httpVersion: "1.1",
        useBinaryFormat: binary,
        jsonOptions: { registry },
      }),
  },
];

/** Les encodages à éprouver : le gRPC natif n'existe qu'en binaire ici. */
function encodings(c: ICase): boolean[] {
  return c.protocol === "grpc" ? [true] : [true, false];
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

/**
 * Appels de `Say` servis sous ce témoin (`x-witness`) : le témoin des appels
 * refusés. Propre à chaque test — les autres fichiers appellent `Say` en
 * parallèle, un compteur global se laissait fausser.
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

/** Un message qui exerce chaque famille de type du contrat. */
function complex(raw: Uint8Array | null): Complex {
  return create(ComplexSchema, {
    header: {
      sentAt: timestampFromDate(new Date("2026-11-12T10:00:00.123Z")),
      ttl: { seconds: 90n, nanos: 500_000_000 },
      sequence: -9_007_199_254_740_993n, // au-delà de Number.MAX_SAFE_INTEGER
      big: 18_446_744_073_709_551_615n, // uint64 maximal
    },
    payload:
      raw === null
        ? {
            case: "tree",
            value: {
              label: "racine — ünïcødé 🌳",
              children: [
                { label: "a", children: [{ label: "a.1", children: [] }] },
                { label: "b", children: [] },
              ],
            },
          }
        : { case: "raw", value: raw },
    forest: {
      nord: { label: "n", children: [{ label: "n.1", children: [] }] },
      "clé avec espace": { label: "e", children: [] },
    },
    history: [
      { sequence: 1n, big: 2n },
      { sequence: -3n, big: 0n },
    ],
    level: Complex_Level.HIGH,
    score: 0.1 + 0.2,
    attributes: {
      fields: {
        nombre: { kind: { case: "numberValue", value: 42.5 } },
        liste: {
          kind: {
            case: "listValue",
            value: {
              values: [
                { kind: { case: "stringValue", value: "x" } },
                { kind: { case: "boolValue", value: true } },
                { kind: { case: "nullValue", value: 0 } },
              ],
            },
          },
        },
      },
    },
    extra: anyPack(TreeSchema, create(TreeSchema, { label: "emballé" })),
    tags: ["", "a", "é"],
    codes: { [-1]: "moins un", 0: "zéro", 2147483647: "max" },
    flag: true,
    ratio: 0.5,
    delta: -123456,
    stamp: 0xffff_ffff_ffffn,
  });
}

/** Une file que l'on remplit au fil de l'eau : pour entrelacer un flux. */
function queue<T>(): {
  push(v: T): void;
  end(): void;
  iterable: AsyncIterable<T>;
} {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(v) {
      items.push(v);
      wake?.();
      wake = null;
    },
    end() {
      done = true;
      wake?.();
      wake = null;
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = items.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (done) return;
          await new Promise<void>((r) => (wake = r));
        }
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("gRPC — matrice servie (critère 13, ADR-0026 D3)", () => {
  for (const c of SERVED) {
    for (const binary of encodings(c)) {
      const label = `${c.label} ${binary ? "binaire" : "JSON"}`;

      it(`${label} : unaire, à travers le pipeline`, async () => {
        const client = createClient(EchoService, c.transport(binary));
        const r = await client.say({ sentence: "bonjour" });
        expect(r.sentence).to.equal("bonjour");
        expect(r.requestId, "requestId du contexte Nodefony").to.match(
          /^[0-9a-f-]{36}$/,
        );
      });

      it(`${label} : erreur levée → statut 9 au format du protocole`, async () => {
        const client = createClient(EchoService, c.transport(binary));
        const err = await connectErrorOf(client.fail({}));
        expect(err.code).to.equal(Code.FailedPrecondition);
        expect(err.rawMessage).to.equal("échec voulu");
      });

      it(`${label} : types complexes renvoyés à l'identique`, async () => {
        const client: Client<typeof EchoService> = createClient(
          EchoService,
          c.transport(binary),
        );
        const sent = complex(null);
        const r = await client.mirror({ value: sent });
        expect(r.value, "réponse sans valeur").to.not.equal(undefined);
        if (r.value === undefined) return;
        expect(equals(ComplexSchema, r.value, sent)).to.equal(true);
        expect(r.value.header?.big).to.equal(18_446_744_073_709_551_615n);
      });

      it(`${label} : charge de 512 Kio, octet pour octet`, async () => {
        const client = createClient(EchoService, c.transport(binary));
        const raw = new Uint8Array(512 * 1024);
        for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + 7) & 0xff;
        const r = await client.mirror({ value: complex(raw) });
        expect(r.rawSize).to.equal(raw.length);
        const back = r.value?.payload;
        expect(back?.case).to.equal("raw");
        if (back?.case === "raw") {
          expect(Buffer.compare(back.value, raw)).to.equal(0);
        }
      });
    }
  }

  it("5151 HTTP/1.1 gRPC natif : échec franc, avant l'échéance (critère 15)", async () => {
    const client = createClient(
      EchoService,
      createGrpcTransport({ baseUrl: H1 }),
    );
    const err = await connectErrorOf(
      client.say({ sentence: "x" }, { timeoutMs: 10_000 }),
    );
    // Le serveur HTTP/1.1 ne lit pas la préface HTTP/2 et coupe : le client
    // lit `ERR_HTTP2_ERROR: Protocol error`, que Connect classe 13 (constaté).
    // Jamais une échéance atteinte, qui dirait une connexion pendante.
    expect(err.code).to.not.equal(Code.DeadlineExceeded);
    expect(err.code).to.equal(Code.Internal);
    expect(String(err.cause)).to.match(/ERR_HTTP2_ERROR/);
  });
});

/** Délai de réponse par défaut des serveurs (`http.responseTimeout`). */
const RESPONSE_TIMEOUT_MS = 30_000;

/** L'en-tête d'échéance du protocole, posé à la main : aucun minuteur client. */
function deadlineHeader(c: ICase, ms: number): Record<string, string> {
  return c.protocol === "connect"
    ? { "connect-timeout-ms": String(ms) }
    : { "grpc-timeout": `${ms}m` };
}

describe("gRPC — échéance d'un appel unaire (critères 19 et 20, ADR-0026 D4)", () => {
  for (const c of SERVED) {
    const binary = c.protocol !== "connect";

    it(`${c.label} : sans échéance du client, le gestionnaire n'en voit aucune`, async () => {
      // Le délai du serveur n'est pas déguisé en échéance reçue : la suite de
      // conformité de Connect le refuse (« server echoed back a timeout »).
      const client = createClient(EchoService, c.transport(binary));
      const r = await client.stall({ block: false });
      expect(r.hasDeadline).to.equal(false);
    });

    it(`${c.label} : client à 120 s, le gestionnaire la voit — jamais INVALID_ARGUMENT`, async () => {
      const client = createClient(EchoService, c.transport(binary));
      const r = await client.stall({ block: false }, { timeoutMs: 120_000 });
      expect(r.hasDeadline).to.equal(true);
      expect(r.timeoutMs).to.be.within(119_000, 120_000);
    });
  }

  // Tous les décors EN PARALLÈLE : un seul délai de réponse à attendre.
  it(
    "client à 120 s, gestionnaire sourd : 4 au délai de réponse du serveur, jamais 504/408 (tous les décors)",
    async () => {
      const results = await Promise.all(
        SERVED.map(async (c) => {
          const client = createClient(
            EchoService,
            c.transport(c.protocol !== "connect"),
          );
          const witness = randomUUID();
          const err = await connectErrorOf(
            client.stall(
              { block: true, witness },
              { headers: deadlineHeader(c, 120_000) },
            ),
          );
          // Client NEUF : après 30 s sans trame, la session HTTP/2 a reçu son
          // GOAWAY (`http2Goaway.ts#closeIdleSession`) ; un nouvel appel sur
          // elle serait refusé (`REFUSED_STREAM`, rejouable).
          const seen = await createClient(
            EchoService,
            c.transport(c.protocol !== "connect"),
          ).stall({ block: false, witness });
          return { label: c.label, code: err.code, aborted: seen.aborted };
        }),
      );
      for (const r of results) {
        expect(r.code, r.label).to.equal(Code.DeadlineExceeded);
        expect(r.aborted, r.label).to.equal(true);
      }
    },
    RESPONSE_TIMEOUT_MS + 15_000,
  );
});

describe("gRPC — flux bidirectionnel entrelacé (corps lu au fil de l'eau)", () => {
  const bidi: Array<[string, () => Transport]> = [
    [
      "5152 HTTP/2+TLS gRPC",
      () => createGrpcTransport({ baseUrl: H2_TLS, nodeOptions: TLS }),
    ],
  ];
  if (!IS_PROD_TARGET) {
    bidi.unshift([
      "5153 h2c gRPC",
      () => createGrpcTransport({ baseUrl: H2C }),
    ]);
  }
  for (const [label, transport] of bidi) {
    it(`${label} : chaque réponse arrive AVANT l'envoi suivant`, async () => {
      const client = createClient(EchoService, transport());
      const out = queue<{ sentence: string }>();
      const responses = client.converse(out.iterable)[Symbol.asyncIterator]();
      for (let i = 1; i <= 3; i++) {
        out.push({ sentence: `m${i}` });
        const next = await responses.next();
        expect(next.done).to.equal(false);
        // `received` = i : le serveur a répondu au message i sans attendre i+1.
        expect(next.value).to.include({ sentence: `m${i}`, received: i });
      }
      out.end();
      expect((await responses.next()).done).to.equal(true);
    });
  }
});

describe("gRPC — routage (critères 2 et 4)", () => {
  /** `Say` sous un chemin à casse modifiée : le Router l'accepte, Connect non. */
  const loweredSay: DescMethodUnary = {
    ...EchoService.method.say,
    name: "say",
    parent: { ...EchoService, typeName: "nodefony.test.v1.echoservice" },
  };

  for (const [label, transport] of [
    [
      `gRPC ${IS_PROD_TARGET ? "HTTP/2+TLS" : "h2c"}`,
      () => createGrpcTransport({ baseUrl: H2, nodeOptions: TLS }),
    ],
    [
      "Connect HTTP/1.1",
      () => createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
    ],
  ] as const) {
    it(`${label} : casse modifiée → 12 UNIMPLEMENTED, la méthode n'est PAS appelée`, async () => {
      const witness = randomUUID();
      const before = await sayCalls(witness);
      const err = await connectErrorOf(
        transport().unary(
          loweredSay,
          undefined,
          undefined,
          { "x-witness": witness },
          { sentence: "x" },
        ),
      );
      expect(err.code).to.equal(Code.Unimplemented);
      // Témoin : seul l'appel témoin a été compté.
      expect(await sayCalls(witness)).to.equal(before + 1);
    });
  }

  it("GET sur une méthode sans NO_SIDE_EFFECTS → 405, Allow: POST", async () => {
    const message = encodeURIComponent(JSON.stringify({ sentence: "x" }));
    const r = await fetch(
      `${H1}/nodefony.test.v1.EchoService/Say?encoding=json&message=${message}&connect=v1`,
    );
    await r.arrayBuffer();
    expect(r.status).to.equal(405);
    expect(r.headers.get("allow")).to.equal("POST");
  });

  it("GET Connect sur la méthode NO_SIDE_EFFECTS : servie, par GET", async () => {
    const client = createClient(
      EchoService,
      createConnectTransport({
        baseUrl: H1,
        httpVersion: "1.1",
        useHttpGet: true,
      }),
    );
    const r = await client.ping({ sentence: "lecture" });
    expect(r).to.include({ sentence: "lecture", httpMethod: "GET" });
  });
});

describe("gRPC — points normatifs que le pipeline pourrait casser", () => {
  it("Connect GET : paramètres dans n'importe quel ordre, paramètre inconnu toléré (connect-protocol §Unary-Get-Request)", async () => {
    const message = encodeURIComponent(JSON.stringify({ sentence: "ordre" }));
    for (const query of [
      `connect=v1&encoding=json&message=${message}`,
      `message=${message}&inconnu=1&encoding=json&connect=v1`,
      `encoding=json&message=${message}`,
    ]) {
      const r = await fetch(`${H1}/nodefony.test.v1.EchoService/Ping?${query}`);
      expect(r.status, query).to.equal(200);
      expect(await r.json(), query).to.deep.equal({
        sentence: "ordre",
        httpMethod: "GET",
      });
    }
  });

  it("Connect : une erreur unaire part en non-200, Content-Type application/json, corps Error (connect-protocol §Unary-Response)", async () => {
    const r = await fetch(`${H1}/nodefony.test.v1.EchoService/Fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r.status).to.equal(400); // failed_precondition
    expect(r.headers.get("content-type")).to.equal("application/json");
    expect(await r.json()).to.deep.equal({
      code: "failed_precondition",
      message: "échec voulu",
    });
  });

  it("gRPC : statut dans les TRAILERS, même OK, HTTP 200 (grpc PROTOCOL-HTTP2 §Responses)", async () => {
    const { connect } = await import("node:http2");
    const session = connect(H2, TLS);
    try {
      const frame = new Uint8Array([0, 0, 0, 0, 0]);
      const { headers, trailers } = await new Promise<{
        headers: Record<string, unknown>;
        trailers: Record<string, unknown>;
      }>((resolve, reject) => {
        const stream = session.request({
          ":method": "POST",
          ":path": "/nodefony.test.v1.EchoService/Ping",
          "content-type": "application/grpc",
          te: "trailers",
        });
        let headers: Record<string, unknown> = {};
        stream.on("response", (h) => (headers = h));
        stream.on("trailers", (t) => resolve({ headers, trailers: t }));
        stream.on("error", reject);
        stream.resume();
        stream.end(frame);
      });
      expect(headers[":status"]).to.equal(200);
      expect(headers["grpc-status"], "pas dans les en-têtes").to.equal(
        undefined,
      );
      expect(trailers["grpc-status"]).to.equal("0");
    } finally {
      session.close();
    }
  });
});

describe("gRPC — un navigateur ne forge pas d'appel (critère 14)", () => {
  for (const [type, body] of [
    ["application/x-www-form-urlencoded", "sentence=x"],
    ["multipart/form-data; boundary=b", "--b\r\n\r\nx\r\n--b--\r\n"],
    ["text/plain", '{"sentence":"x"}'],
  ] as const) {
    it(`POST ${type.split(";")[0]} → 415, la méthode n'est PAS appelée`, async () => {
      const witness = randomUUID();
      const before = await sayCalls(witness);
      const r = await fetch(`${H1}/nodefony.test.v1.EchoService/Say`, {
        method: "POST",
        headers: { "content-type": type, "x-witness": witness },
        body,
      });
      await r.arrayBuffer();
      expect(r.status).to.equal(415);
      expect(await sayCalls(witness)).to.equal(before + 1);
    });
  }

  it("CONTRÔLE POSITIF : le même POST en application/json est servi", async () => {
    const r = await fetch(`${H1}/nodefony.test.v1.EchoService/Say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"sentence":"x"}',
    });
    expect(r.status).to.equal(200);
    expect(await r.json()).to.include({ sentence: "x" });
  });
});

describe("gRPC — portée du contrôleur (critère 6)", () => {
  it("singleton (défaut) : la même instance sert chaque appel", async () => {
    const client = createClient(
      EchoService,
      createGrpcTransport({ baseUrl: H2, nodeOptions: TLS }),
    );
    const seen = new Set<number>();
    for (let i = 0; i < 3; i++) {
      seen.add((await client.say({ sentence: "x" })).instance);
    }
    expect(seen.size).to.equal(1);
  });

  it('@Scope("request") : une instance neuve par appel', async () => {
    const client = createClient(
      ScopedEchoService,
      createGrpcTransport({ baseUrl: H2, nodeOptions: TLS }),
    );
    const a = (await client.who({})).instance;
    const b = (await client.who({})).instance;
    const c = (await client.who({})).instance;
    expect(b).to.be.greaterThan(a);
    expect(c).to.be.greaterThan(b);
  });
});
