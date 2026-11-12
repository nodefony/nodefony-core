/// <reference types="node" />
//
// ─── Interopérabilité gRPC avec des clients TIERS (#695, critère 53) ────────
//
// Décor : serveur de dev (skill `nodefony-start-server`) — 5152 HTTP/2 + TLS,
// 5153 h2c (éteint en production : TLS seul). Deux clients qui ne partagent
// RIEN avec Nodefony ni avec Connect :
//
// - `@grpc/grpc-js` + `@grpc/proto-loader` — la pile du SDK A2A JS, codec
//   protobufjs ;
// - `grpcurl` — grpc-go, l'écosystème Go. Capacité de la MACHINE, constatée
//   ici ; installée, version figée, dans le job Linux de la CI. Ailleurs, son
//   absence s'énonce (`NF_GATES_ALLOW=grpcurl`) — `gates.ts#GRPCURL_EXPECTATION`.
//
// Les deux lisent un descriptor set bâti depuis le code GÉNÉRÉ du module
// `test` : il couvre aussi le service de conformité, dont la source `.proto`
// n'est pas dans le dépôt. Le service de conformité renvoie ce qu'il a reçu
// (en-têtes, échéance) : c'est lui qui prouve le sens client → serveur.
//
// ADR-0026 D13. Le 429 n'est pas joué de bout en bout : aucune route gRPC n'en
// produit (seul le recul de connexion en émet). « Refus → 14 » se prouve par le
// 421 — même écrivain (`refusal.ts#prepareGrpcRefusal`), même ligne de table.
//
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create, toBinary, type DescFile } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { expect } from "vitest";
import { file_connectrpc_conformance_v1_service } from "../../../../../../modules/test/nodefony/gen/connectrpc/conformance/v1/service_pb.js";
import { file_nodefony_test_v1_echo } from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/echo_pb.js";
import { IS_PROD_TARGET } from "../../../../http/nodefony/tests/helpers/targetEnv";

const REPO_ROOT = fileURLToPath(
  new URL("../../../../../../../", import.meta.url),
);
const CA = path.join(
  REPO_ROOT,
  "nodefony",
  "config",
  "certificates",
  "ca",
  "nodefony-root-ca.crt.pem",
);
const ECHO = "nodefony.test.v1.EchoService";
const CONFORMANCE = "connectrpc.conformance.v1.ConformanceService";
/** 3,5 Mio : sous la borne de 4 Mio que le lot 4 pose par défaut. */
const LARGE = 3.5 * 1024 * 1024;
/** `[0, 1, 255]` en base64 : forme d'une valeur `-bin` sur le fil. */
const BIN = "AAH/";

// ── Descriptor set : le contrat, lu par des piles qui ne sont pas les nôtres ──

/** Les fichiers et leurs dépendances, chaque dépendance AVANT qui l'importe. */
function descriptorSet(...roots: DescFile[]): Uint8Array {
  const files = new Map<string, DescFile>();
  const visit = (file: DescFile): void => {
    if (files.has(file.name)) return;
    for (const dep of file.dependencies) visit(dep);
    files.set(file.name, file);
  };
  for (const root of roots) visit(root);
  return toBinary(
    FileDescriptorSetSchema,
    create(FileDescriptorSetSchema, {
      file: [...files.values()].map((f) => f.proto),
    }),
  );
}

const SET = descriptorSet(
  file_nodefony_test_v1_echo,
  file_connectrpc_conformance_v1_service,
);
const PACKAGE = grpc.loadPackageDefinition(
  loader.loadFileDescriptorSetFromBuffer(Buffer.from(SET), {
    longs: String,
    bytes: Buffer,
    defaults: true,
    oneofs: true,
  }),
);

function isServiceCtor(v: unknown): v is grpc.ServiceClientConstructor {
  return typeof v === "function" && "service" in v;
}

/** Un champ d'un objet décodé, ou `undefined`. */
function at(value: unknown, ...keys: string[]): unknown {
  let node = value;
  for (const key of keys) {
    if (node === null || typeof node !== "object") return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

/** La définition (chemin + codec protobufjs) d'une méthode du contrat. */
function method(
  service: string,
  name: string,
): grpc.MethodDefinition<object, unknown> {
  let node: unknown = PACKAGE;
  for (const part of service.split(".")) {
    node =
      node !== null && (typeof node === "object" || typeof node === "function")
        ? Reflect.get(node, part)
        : undefined;
  }
  if (!isServiceCtor(node))
    throw new Error(`${service} absent du descriptor set`);
  const def = node.service[name];
  if (def === undefined) throw new Error(`${service}/${name} absente`);
  return def;
}

// ── Les deux portes HTTP/2 ────────────────────────────────────────────────────

interface IEndpoint {
  readonly label: string;
  readonly target: string;
  readonly credentials: () => grpc.ChannelCredentials;
  /** Arguments de transport de grpcurl. */
  readonly grpcurl: readonly string[];
}

const H2C: IEndpoint = {
  label: "h2c 5153",
  target: "127.0.0.1:5153",
  credentials: () => grpc.credentials.createInsecure(),
  grpcurl: ["-plaintext"],
};
const TLS: IEndpoint = {
  label: "TLS 5152",
  target: "localhost:5152",
  credentials: () => grpc.credentials.createSsl(readFileSync(CA)),
  grpcurl: ["-cacert", CA],
};
/** h2c n'existe que sur l'app de dev (`servers.h2c`, éteint en production). */
const ENDPOINTS: IEndpoint[] = [...(IS_PROD_TARGET ? [] : [H2C]), TLS];

// ── grpc-js ───────────────────────────────────────────────────────────────────

interface IReply {
  readonly value: unknown;
  readonly headers: grpc.Metadata;
  readonly trailers: grpc.Metadata;
}

function isServiceError(e: unknown): e is grpc.ServiceError {
  return e instanceof Error && "code" in e && typeof e.code === "number";
}

/**
 * Un appel unaire. Les trailers se lisent sur `status`, qui part APRÈS le
 * rappel : les lire dans le rappel les donne vides (piège D13).
 */
function unary(
  client: grpc.Client,
  def: grpc.MethodDefinition<object, unknown>,
  arg: object,
  metadata: grpc.Metadata = new grpc.Metadata(),
  options: grpc.CallOptions = {},
): Promise<IReply> {
  return new Promise<IReply>((resolve, reject) => {
    let headers = new grpc.Metadata();
    let value: unknown;
    let failure: grpc.ServiceError | null = null;
    const call = client.makeUnaryRequest(
      def.path,
      def.requestSerialize,
      def.responseDeserialize,
      arg,
      metadata,
      options,
      (err, res) => {
        failure = err;
        value = res;
      },
    );
    call.on("metadata", (m: grpc.Metadata) => (headers = m));
    call.on("status", (s: grpc.StatusObject) => {
      if (failure !== null) reject(failure);
      else resolve({ value, headers, trailers: s.metadata });
    });
  });
}

/** Le statut d'un appel qui doit échouer. */
async function statusOf(p: Promise<unknown>): Promise<grpc.ServiceError> {
  try {
    await p;
  } catch (e) {
    if (isServiceError(e)) return e;
    throw e;
  }
  throw new Error("l'appel devait échouer");
}

const clients: grpc.Client[] = [];
function client(
  endpoint: IEndpoint,
  options: grpc.ChannelOptions = {},
): grpc.Client {
  const c = new grpc.Client(endpoint.target, endpoint.credentials(), options);
  clients.push(c);
  return c;
}

/** Une requête de conformité : ce qu'on veut recevoir, et le témoin de ce qui a été reçu. */
function conformance(definition: object): object {
  return {
    response_definition: { response_data: Buffer.from("ok"), ...definition },
  };
}

/** Les en-têtes que le serveur a reçus, `nom → valeurs`. */
function receivedHeaders(value: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const list = at(value, "payload", "request_info", "request_headers");
  if (!Array.isArray(list)) return out;
  for (const h of list) {
    const name = at(h, "name");
    if (typeof name === "string") out.set(name, at(h, "value"));
  }
  return out;
}

// ── grpcurl ───────────────────────────────────────────────────────────────────

const VERSION = spawnSync("grpcurl", ["-version"], { encoding: "utf8" });
/** Capacité CONSTATÉE, jamais déduite de la plateforme. */
const HAS_GRPCURL = VERSION.error === undefined && VERSION.status === 0;

interface IRun {
  /** 0, ou 64 + le statut gRPC (convention de grpcurl). */
  readonly exit: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

let workDir = "";
let protoset = "";

function grpcurl(args: readonly string[], input?: string): IRun {
  const t0 = performance.now();
  const run = spawnSync("grpcurl", ["-max-time", "5", ...args], {
    encoding: "utf8",
    input,
    timeout: 15_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exit: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    ms: performance.now() - t0,
  };
}

function grpcurlJson(run: IRun): unknown {
  expect(run.exit, run.stderr).to.equal(0);
  return JSON.parse(run.stdout);
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "nf-grpc-interop-"));
  protoset = path.join(workDir, "contract.protoset");
  writeFileSync(protoset, SET);
  // Contrats qu'aucun service ne sert : grpcurl refuse d'appeler un symbole
  // qu'il ne connaît pas, il faut donc les lui DÉCLARER.
  writeFileSync(
    path.join(workDir, "nope.proto"),
    'syntax = "proto3";\npackage nodefony.test.v1;\nmessage NopeRequest {}\nservice Nope { rpc Call(NopeRequest) returns (NopeRequest); }\n',
  );
  writeFileSync(
    path.join(workDir, "lowered.proto"),
    'syntax = "proto3";\npackage nodefony.test.v1;\nmessage LoweredRequest { string sentence = 1; }\nservice echoservice { rpc say(LoweredRequest) returns (LoweredRequest); }\n',
  );
});

afterAll(() => {
  for (const c of clients) c.close();
  rmSync(workDir, { recursive: true, force: true });
});

// ── Cas ───────────────────────────────────────────────────────────────────────

describe("gRPC — interopérabilité avec @grpc/grpc-js (critère 53)", () => {
  for (const endpoint of ENDPOINTS) {
    describe(`grpc-js ${endpoint.label}`, () => {
      it("unaire servi à travers le pipeline", async () => {
        const r = await unary(client(endpoint), method(ECHO, "Say"), {
          sentence: "bonjour",
        });
        expect(at(r.value, "sentence")).to.equal("bonjour");
        expect(at(r.value, "request_id")).to.match(/^[0-9a-f-]{36}$/);
      });

      it("flux bidirectionnel ENTRELACÉ : chaque réponse avant l'envoi suivant", async () => {
        const def = method(ECHO, "Converse");
        const call = client(endpoint).makeBidiStreamRequest(
          def.path,
          def.requestSerialize,
          def.responseDeserialize,
          new grpc.Metadata(),
          {},
        );
        const responses = call[Symbol.asyncIterator]();
        for (let i = 1; i <= 3; i++) {
          call.write({ sentence: `m${i}` });
          const next = await responses.next();
          expect(at(next.value, "sentence")).to.equal(`m${i}`);
          expect(at(next.value, "received")).to.equal(i);
        }
        call.end();
        expect((await responses.next()).done).to.equal(true);
      });

      it("erreur métier → 9 et son message", async () => {
        const err = await statusOf(
          unary(client(endpoint), method(ECHO, "Fail"), {}),
        );
        expect(err.code).to.equal(grpc.status.FAILED_PRECONDITION);
        expect(err.details).to.equal("échec voulu");
      });

      it("échéance : reçue par le serveur, et dépassée → 4", async () => {
        const c = client(endpoint);
        const def = method(CONFORMANCE, "Unary");
        const served = await unary(c, def, conformance({}), undefined, {
          deadline: Date.now() + 5_000,
        });
        const timeoutMs = Number(
          at(served.value, "payload", "request_info", "timeout_ms"),
        );
        expect(timeoutMs).to.be.greaterThan(0).and.at.most(5_000);
        const err = await statusOf(
          unary(c, def, conformance({ response_delay_ms: 2_000 }), undefined, {
            deadline: Date.now() + 300,
          }),
        );
        expect(err.code).to.equal(grpc.status.DEADLINE_EXCEEDED);
      });

      it("métadonnées texte et -bin, dans les deux sens", async () => {
        const md = new grpc.Metadata();
        md.add("x-req", "texte");
        md.add("x-req-bin", Buffer.from([0, 1, 255]));
        const r = await unary(
          client(endpoint),
          method(CONFORMANCE, "Unary"),
          conformance({
            response_headers: [
              { name: "x-resp", value: ["r"] },
              { name: "x-resp-bin", value: [BIN] },
            ],
            response_trailers: [{ name: "x-trail-bin", value: [BIN] }],
          }),
          md,
        );
        const received = receivedHeaders(r.value);
        expect(received.get("x-req")).to.deep.equal(["texte"]);
        expect(received.get("x-req-bin")).to.deep.equal([BIN]);
        expect(r.headers.get("x-resp")).to.deep.equal(["r"]);
        expect(r.headers.get("x-resp-bin")).to.deep.equal([
          Buffer.from([0, 1, 255]),
        ]);
        expect(r.trailers.get("x-trail-bin")).to.deep.equal([
          Buffer.from([0, 1, 255]),
        ]);
      });

      it("requête compressée gzip : servie", async () => {
        const r = await unary(
          client(endpoint, {
            "grpc.default_compression_algorithm":
              grpc.compressionAlgorithms.gzip,
          }),
          method(CONFORMANCE, "Unary"),
          conformance({}),
        );
        expect(receivedHeaders(r.value).get("grpc-encoding")).to.deep.equal([
          "gzip",
        ]);
      });

      it("message de 3,5 Mio, octet pour octet", async () => {
        const raw = Buffer.alloc(LARGE);
        for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + 7) & 0xff;
        const r = await unary(client(endpoint), method(ECHO, "Mirror"), {
          value: { raw },
        });
        expect(at(r.value, "raw_size")).to.equal(LARGE);
        const back = at(r.value, "value", "raw");
        expect(
          Buffer.isBuffer(back) && Buffer.compare(back, raw) === 0,
        ).to.equal(true);
      });

      it("PING de maintien toutes les 200 ms sur un flux d'1,2 s : rien ne coupe", async () => {
        const def = method(ECHO, "Converse");
        const call = client(endpoint, {
          "grpc.keepalive_time_ms": 200,
          "grpc.keepalive_timeout_ms": 1_000,
          "grpc.keepalive_permit_without_calls": 1,
        }).makeBidiStreamRequest(
          def.path,
          def.requestSerialize,
          def.responseDeserialize,
          new grpc.Metadata(),
          {},
        );
        const responses = call[Symbol.asyncIterator]();
        for (let i = 1; i <= 4; i++) {
          call.write({ sentence: `p${i}` });
          expect(at((await responses.next()).value, "received")).to.equal(i);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        call.end();
        expect((await responses.next()).done).to.equal(true);
      });

      it("réflexion absente → 12, en moins d'une seconde (corps jamais fini)", async () => {
        const c = client(endpoint);
        const t0 = performance.now();
        const code = await new Promise<number>((resolve) => {
          const call = c.makeBidiStreamRequest(
            "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
            (b: Buffer) => b,
            (b: Buffer) => b,
            new grpc.Metadata(),
            { deadline: Date.now() + 5_000 },
          );
          call.on("data", () => undefined);
          call.on("error", (e: unknown) =>
            resolve(isServiceError(e) ? e.code : -1),
          );
          // Comme `grpcurl list` : une requête émise, le flux laissé ouvert.
          call.write(Buffer.from([0x3a, 0x00]));
        });
        expect(code).to.equal(grpc.status.UNIMPLEMENTED);
        expect(performance.now() - t0).to.be.lessThan(1_000);
      });

      it("méthode inconnue et casse modifiée → 12", async () => {
        const c = client(endpoint);
        const say = method(ECHO, "Say");
        for (const target of [
          "/nodefony.test.v1.Nope/Call",
          "/nodefony.test.v1.echoservice/say",
        ]) {
          const err = await statusOf(
            unary(c, { ...say, path: target }, { sentence: "x" }),
          );
          expect(err.code, target).to.equal(grpc.status.UNIMPLEMENTED);
        }
      });

      it("hôte non servi (421) → 14 UNAVAILABLE", async () => {
        const err = await statusOf(
          unary(
            client(endpoint, {
              "grpc.default_authority": "evil.example",
              "grpc.ssl_target_name_override": "localhost",
            }),
            method(ECHO, "Say"),
            { sentence: "x" },
          ),
        );
        expect(err.code).to.equal(grpc.status.UNAVAILABLE);
      });
    });
  }
});

describe.skipIf(!HAS_GRPCURL)(
  "gRPC — interopérabilité avec grpcurl (critères 53 et 60)",
  () => {
    for (const endpoint of ENDPOINTS) {
      describe(`grpcurl ${endpoint.label}`, () => {
        const base = (): string[] => [
          "-protoset",
          protoset,
          ...endpoint.grpcurl,
        ];

        it("grpcurl : unaire servi", () => {
          const out = grpcurlJson(
            grpcurl([
              ...base(),
              "-d",
              '{"sentence":"bonjour"}',
              endpoint.target,
              `${ECHO}/Say`,
            ]),
          );
          expect(at(out, "sentence")).to.equal("bonjour");
        });

        it("grpcurl : flux bidirectionnel, trois messages, trois réponses", () => {
          const run = grpcurl(
            [...base(), "-d", "@", endpoint.target, `${ECHO}/Converse`],
            '{"sentence":"m1"}\n{"sentence":"m2"}\n{"sentence":"m3"}\n',
          );
          expect(run.exit, run.stderr).to.equal(0);
          const received = [...run.stdout.matchAll(/"received":\s*(\d+)/g)].map(
            (m) => Number(m[1]),
          );
          expect(received).to.deep.equal([1, 2, 3]);
        });

        it("grpcurl : erreur métier → 9 (sortie 73) et son message", () => {
          const run = grpcurl([...base(), endpoint.target, `${ECHO}/Fail`]);
          expect(run.exit).to.equal(64 + 9);
          expect(run.stderr).to.include("échec voulu");
        });

        it("grpcurl : échéance reçue par le serveur, et dépassée → 4 (sortie 68)", () => {
          const served = grpcurlJson(
            grpcurl([
              ...base(),
              "-d",
              "{}",
              endpoint.target,
              `${CONFORMANCE}/Unary`,
            ]),
          );
          const timeoutMs = Number(
            at(served, "payload", "requestInfo", "timeoutMs"),
          );
          expect(timeoutMs).to.be.greaterThan(0).and.at.most(5_000);
          const run = grpcurl([
            ...base(),
            "-max-time",
            "0.3",
            "-d",
            '{"responseDefinition":{"responseDelayMs":2000}}',
            endpoint.target,
            `${CONFORMANCE}/Unary`,
          ]);
          expect(run.exit).to.equal(64 + 4);
        });

        it("grpcurl : métadonnées texte et -bin, dans les deux sens", () => {
          const run = grpcurl([
            ...base(),
            "-v",
            "-H",
            "x-req: texte",
            "-H",
            `x-req-bin: ${BIN}`,
            "-d",
            JSON.stringify({
              responseDefinition: {
                responseHeaders: [
                  { name: "x-resp", value: ["r"] },
                  { name: "x-resp-bin", value: [BIN] },
                ],
                responseTrailers: [{ name: "x-trail-bin", value: [BIN] }],
              },
            }),
            endpoint.target,
            `${CONFORMANCE}/Unary`,
          ]);
          expect(run.exit, run.stderr).to.equal(0);
          const [, headers = "", , trailers = ""] = run.stdout.split(
            /Response headers received:|Response contents:|Response trailers received:/,
          );
          expect(headers)
            .to.include("x-resp: r")
            .and.include(`x-resp-bin: ${BIN}`);
          expect(trailers).to.include(`x-trail-bin: ${BIN}`);
          expect(run.stdout).to.match(
            /"name": "x-req",\s*"value": \[\s*"texte"/,
          );
          expect(run.stdout).to.match(
            new RegExp(`"name": "x-req-bin",\\s*"value": \\[\\s*"${BIN}"`),
          );
        });

        it("grpcurl : message de 3,5 Mio, taille rendue à l'identique", () => {
          const raw = Buffer.alloc(LARGE, 7);
          const out = grpcurlJson(
            grpcurl(
              [...base(), "-d", "@", endpoint.target, `${ECHO}/Mirror`],
              JSON.stringify({ value: { raw: raw.toString("base64") } }),
            ),
          );
          expect(at(out, "rawSize")).to.equal(LARGE);
        });

        it("grpcurl list : « does not support the reflection API » en moins d'une seconde (critère 60)", () => {
          const run = grpcurl([...endpoint.grpcurl, endpoint.target, "list"]);
          expect(run.exit).to.not.equal(0);
          expect(run.stderr).to.include("does not support the reflection API");
          expect(run.ms).to.be.lessThan(1_000);
        });

        it("grpcurl : méthode inconnue et casse modifiée → 12 (sortie 76)", () => {
          const decl = (file: string): string[] => [
            ...endpoint.grpcurl,
            "-import-path",
            workDir,
            "-proto",
            file,
          ];
          const nope = grpcurl([
            ...decl("nope.proto"),
            endpoint.target,
            "nodefony.test.v1.Nope/Call",
          ]);
          expect(nope.exit, nope.stderr).to.equal(64 + 12);
          const lowered = grpcurl([
            ...decl("lowered.proto"),
            "-d",
            '{"sentence":"x"}',
            endpoint.target,
            "nodefony.test.v1.echoservice/say",
          ]);
          expect(lowered.exit, lowered.stderr).to.equal(64 + 12);
        });

        it("grpcurl : hôte non servi (421) → 14 UNAVAILABLE (sortie 78)", () => {
          // En TLS, grpcurl vérifie le certificat contre `-authority` et refuse
          // un `-servername` différent : la vérification se coupe pour CE cas.
          const transport = endpoint === TLS ? ["-insecure"] : endpoint.grpcurl;
          const run = grpcurl([
            "-protoset",
            protoset,
            ...transport,
            "-authority",
            "evil.example",
            endpoint.target,
            `${ECHO}/Say`,
          ]);
          expect(run.exit, run.stderr).to.equal(64 + 14);
        });
      });
    }
  },
);
