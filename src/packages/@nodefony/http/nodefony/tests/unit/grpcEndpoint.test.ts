/// <reference types="node" />
//
// ─── @nodefony/http/grpc : fiche d'appel, garde `abort`, point d'entrée (#695) ──
//
// ADR-0026 D3 (protocoles), D4 (un seul écrivain, bornes), D6 (fiche d'appel). Le point
// d'entrée est éprouvé sur un VRAI serveur `node:http`, l'adaptateur Connect
// réel derrière : seul le contexte Nodefony est factice (ce qu'il lit est
// petit et nommé ci-dessous).
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `hasAbort` → `return true` ;
//   - `GrpcEndpoint.#build` : les options `grpc` / `grpcWeb` / `connect` ;
//   - `GrpcEndpoint.#build` : `readMaxBytes` (la bombe gzip abat le worker,
//     faute de mémoire) ou `writeMaxBytes` ;
//   - `registerMethods` : une option passée à `router.rpc` (garde de #1835) ;
//   - `GrpcEndpoint.serve` : `disarmResponseTimeout`, `context.sended = true`,
//     ou le `catch` de l'appel synchrone.
//
import { expect, vi } from "vitest";
import { Nodefony } from "nodefony";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
  file_google_protobuf_any,
} from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createContextKey,
  createHandlerContext,
  type HandlerContext,
} from "@connectrpc/connect";
import {
  GrpcCall,
  GrpcEndpoint,
  hasAbort,
  type IGrpcSettings,
} from "../../grpc/index";
import { GRPC_DEFAULT_MAX_MESSAGE_BYTES } from "../../src/grpc/limits";
import type { IRpcCall } from "../../interfaces/IRpcCall";
import zlib from "node:zlib";
import { once } from "node:events";
import HttpError from "../../src/errors/httpError";
import type HttpContext from "../../src/context/http/HttpContext";
import { responseEnded } from "../../src/context/responseEnded";

// ─── Contrat construit à la volée : un service par cas ───────────────────────

/** Un service dont le message porte un `google.protobuf.Any`. */
function makeAnyService(): DescService {
  serial += 1;
  const file = create(FileDescriptorProtoSchema, {
    name: `any_${serial}.proto`,
    package: "nodefony.httptest.v1",
    syntax: "proto3",
    dependency: ["google/protobuf/any.proto"],
    messageType: [
      {
        name: "Inner",
        field: [
          {
            name: "label",
            jsonName: "label",
            number: 1,
            type: FieldDescriptorProto_Type.STRING,
            label: FieldDescriptorProto_Label.OPTIONAL,
          },
        ],
      },
      {
        name: "Wrapped",
        field: [
          {
            name: "extra",
            jsonName: "extra",
            number: 1,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: ".google.protobuf.Any",
            label: FieldDescriptorProto_Label.OPTIONAL,
          },
        ],
      },
    ],
    service: [
      {
        name: `Any${serial}Service`,
        method: [
          {
            name: "Say",
            inputType: ".nodefony.httptest.v1.Wrapped",
            outputType: ".nodefony.httptest.v1.Wrapped",
          },
        ],
      },
    ],
  });
  const service = createFileRegistry(file, (name) =>
    name === "google/protobuf/any.proto" ? file_google_protobuf_any : undefined,
  ).getService(`nodefony.httptest.v1.Any${serial}Service`);
  if (service === undefined) throw new Error("service introuvable");
  return service;
}

let serial = 0;
function makeService(
  withStream = false,
  withClientStream = false,
): DescService {
  serial += 1;
  const file = create(FileDescriptorProtoSchema, {
    name: `endpoint_${serial}.proto`,
    package: "nodefony.httptest.v1",
    syntax: "proto3",
    messageType: [
      {
        name: "Msg",
        field: [
          {
            name: "text",
            jsonName: "text",
            number: 1,
            type: FieldDescriptorProto_Type.STRING,
            label: FieldDescriptorProto_Label.OPTIONAL,
          },
        ],
      },
    ],
    service: [
      {
        name: `Echo${serial}Service`,
        method: [
          {
            name: "Say",
            inputType: ".nodefony.httptest.v1.Msg",
            outputType: ".nodefony.httptest.v1.Msg",
          },
          ...(withStream
            ? [
                {
                  name: "Watch",
                  inputType: ".nodefony.httptest.v1.Msg",
                  outputType: ".nodefony.httptest.v1.Msg",
                  serverStreaming: true,
                },
              ]
            : []),
          ...(withClientStream
            ? [
                {
                  name: "Collect",
                  inputType: ".nodefony.httptest.v1.Msg",
                  outputType: ".nodefony.httptest.v1.Msg",
                  clientStreaming: true,
                },
              ]
            : []),
        ],
      },
    ],
  });
  const service = createFileRegistry(file, () => undefined).getService(
    `nodefony.httptest.v1.Echo${serial}Service`,
  );
  if (service === undefined) throw new Error("service introuvable");
  return service;
}

/** Une cible : répond son nom, et retient la fiche que Connect lui a remise. */
class Target {
  readonly calls: HandlerContext[] = [];
  constructor(readonly name: string) {}
  say(request: { text: string }, ctx: HandlerContext): { text: string } {
    this.calls.push(ctx);
    return { text: `${this.name}:${request.text}` };
  }
}

// ─── Contexte Nodefony factice : seulement ce que `serve` lit ────────────────

interface IFakeContext {
  sended: boolean;
  finished: boolean;
  response: {
    response: http.ServerResponse;
    isHeaderSent(): boolean;
    /** Délai de réponse du contexte (`Response.timeout`, ms). */
    timeout: number;
    /** Chaque recopie de la réserve : le type donné, et si la réponse était déjà partie. */
    commits: Array<{ type: string | undefined; headersSent: boolean }>;
    /** Recopie de la réserve (`HttpResponse.commitHeaders`) : pose un témoin natif. */
    commitHeaders(contentType?: string): void;
    /** Réserve d'en-têtes du pipeline (CORS posé par le pare-feu…), clés en minuscules. */
    reserve: Map<string, string>;
    hasHeader(name: string): boolean;
    getHeader(name: string): string | undefined;
    setHeader(name: string, value: string): void;
  };
  request: { request: http.IncomingMessage; url: URL };
  /** L'appel RPC du contexte (`HttpContext.rpc`), posé par `serve`. */
  rpc: IRpcCall | null;
  httpKernel: (IKernelHooks & { options: { grpc: IGrpcSettings } }) | null;
  logged: unknown[];
  log(error: unknown): void;
  /** L'identité posée par le pare-feu (`Context.authenticatedUser`). */
  authenticatedUser(): object | null;
}

/** L'utilisateur que rendent les contextes factices (règle d'identité, D5). */
let fakeUser: object | null = null;

/** La section `grpc` telle que Zod la rend : tous les champs, défauts compris. */
const SETTINGS: IGrpcSettings = {
  grpc: true,
  grpcWeb: true,
  connect: true,
  readMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  writeMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  requireConnectProtocolHeader: false,
};

/** Ce que le cycle de vie d'un flux demande au noyau — tracé par les tests. */
interface IKernelHooks {
  acquireConnectionSlot?(req: unknown, res: http.ServerResponse): boolean;
  sweepStall?(lifecycle: unknown): void;
  unsweepStall?(lifecycle: unknown): void;
}

function fakeContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  settings: Partial<IGrpcSettings> | null,
  responseTimeout = 30_000,
  hooks: IKernelHooks | null = null,
  reserve: Record<string, string> = {},
): IFakeContext {
  return {
    sended: false,
    finished: false,
    response: {
      response: res,
      isHeaderSent: () => res.headersSent,
      timeout: responseTimeout,
      commits: [],
      commitHeaders(contentType) {
        this.commits.push({ type: contentType, headersSent: res.headersSent });
        // Ce que la réserve porte (CORS, corrélation…) : posé en natif.
        if (!res.headersSent) res.setHeader("x-pipeline", "reserve");
      },
      reserve: new Map(Object.entries(reserve)),
      hasHeader(name) {
        return this.reserve.has(name.toLowerCase());
      },
      getHeader(name) {
        return this.reserve.get(name.toLowerCase());
      },
      setHeader(name, value) {
        this.reserve.set(name.toLowerCase(), value);
      },
    },
    request: { request: req, url: new URL(req.url ?? "/", "http://localhost") },
    rpc: null,
    httpKernel:
      settings === null && hooks === null
        ? null
        : { ...hooks, options: { grpc: { ...SETTINGS, ...settings } } },
    logged: [],
    log(error) {
      this.logged.push(error);
    },
    authenticatedUser: () => fakeUser,
  };
}

const asHttpContext = (c: IFakeContext): HttpContext =>
  c as unknown as HttpContext;

/** Ce que le noyau a fixé au `close` : le code de l'appel et sa cause. */
interface ISettled {
  system: string;
  method: string;
  code: number | null;
  codeName: string | null;
  cause: Error | null;
  ended: boolean;
}

interface IServed {
  context: IFakeContext;
  error: unknown;
  socketTimeoutBefore: number | undefined;
  socketTimeoutAfter: number | undefined;
  /** Fixé au `close` de la réponse, `null` hors appel RPC. */
  settled: ISettled | null;
  /** Résolue au `close` de la réponse, après `settled`. */
  closed: Promise<void>;
}

/** Un serveur dont chaque requête passe par `endpoint.serve`. */
async function serveWith(
  endpoint: GrpcEndpoint,
  pickTarget: () => object,
  settings: Partial<IGrpcSettings> | null = null,
  responseTimeout = 30_000,
  hooks: IKernelHooks | null = null,
  reserve: Record<string, string> = {},
): Promise<{
  url: string;
  port: number;
  served: IServed[];
  close(): Promise<void>;
}> {
  const served: IServed[] = [];
  const server = http.createServer((req, res) => {
    const context = fakeContext(
      req,
      res,
      settings,
      responseTimeout,
      hooks,
      reserve,
    );
    // Le délai que Nodefony arme sur toute requête (`HttpContext.setTimeout`),
    // AVANT que l'adaptateur n'arme le sien. À l'expiration, comme
    // `HttpContext._onTimeout` : un appel RPC est terminé par sa fiche
    // (`context.rpc.expire()`), sinon un 504 part si rien n'est parti.
    // Désarmé par `disarmResponseTimeout` (délai de la socket à 0), il se tait.
    if (res.socket !== null) res.socket.setTimeout(responseTimeout);
    if (responseTimeout > 0) {
      const timer = setTimeout(() => {
        if (res.socket?.timeout === 0 || res.headersSent) return;
        if (context.rpc !== null) {
          context.rpc.expire();
          return;
        }
        res.statusCode = 504;
        res.end();
      }, responseTimeout);
      res.on("close", () => clearTimeout(timer));
    }
    let closed: () => void = () => undefined;
    const record: IServed = {
      context,
      error: null,
      socketTimeoutBefore: res.socket?.timeout,
      socketTimeoutAfter: undefined,
      settled: null,
      closed: new Promise<void>((resolve) => {
        closed = resolve;
      }),
    };
    // Le geste du noyau au `close` (`HttpKernel.settleRpc`) : le code de
    // l'appel est fixé UNE fois, « finie » selon `responseEnded`.
    res.once("close", () => {
      const rpc = context.rpc;
      if (rpc !== null) {
        const ended = responseEnded(res);
        const cause = rpc.settle(ended);
        record.settled = {
          system: rpc.system,
          method: rpc.method,
          code: rpc.code,
          codeName: rpc.codeName,
          cause,
          ended,
        };
      }
      closed();
    });
    served.push(record);
    // Un refus, levé tout de suite ou rendu par la promesse de la remise (flux
    // dont la session est à sauver), part comme le pipeline l'écrirait.
    const refuse = (e: unknown): void => {
      record.error = e;
      res.statusCode = e instanceof HttpError && e.code !== null ? e.code : 599;
      res.end();
    };
    try {
      const pending = endpoint.serve(asHttpContext(context), pickTarget());
      if (pending instanceof Promise) pending.catch(refuse);
    } catch (e) {
      refuse(e);
    }
    record.socketTimeoutAfter = res.socket?.timeout;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    served,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function path(service: DescService): string {
  return `/${service.typeName}/Say`;
}

async function connectJson(
  url: string,
  service: DescService,
  text: string,
): Promise<{ status: number; body: string; headers: Headers }> {
  const r = await fetch(url + path(service), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

/** Un appel gRPC-Web : une enveloppe de 5 octets, message vide. */
async function grpcWeb(url: string, service: DescService): Promise<number> {
  const r = await fetch(url + path(service), {
    method: "POST",
    headers: { "content-type": "application/grpc-web+proto" },
    body: new Uint8Array([0, 0, 0, 0, 0]),
  });
  await r.arrayBuffer();
  return r.status;
}

/** Un appel gRPC natif en HTTP/1.1 : refusé en 415 seulement si coupé. */
async function grpc(url: string, service: DescService): Promise<number> {
  const r = await fetch(url + path(service), {
    method: "POST",
    headers: { "content-type": "application/grpc+proto", te: "trailers" },
    body: new Uint8Array([0, 0, 0, 0, 0]),
  });
  await r.arrayBuffer();
  return r.status;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("GrpcCall — la fiche d'appel est le ContextValues de Connect", () => {
  const key = createContextKey<string>("défaut", { description: "test" });

  it("une clé jamais posée rend sa valeur par défaut", () => {
    expect(new GrpcCall(null).get(key)).to.equal("défaut");
  });

  it("set / get / delete, chaînables, propres à CHAQUE fiche", () => {
    const a = new GrpcCall(null);
    const b = new GrpcCall(null);
    expect(a.set(key, "posée")).to.equal(a);
    expect(a.get(key)).to.equal("posée");
    expect(b.get(key), "une autre fiche n'en voit rien").to.equal("défaut");
    expect(a.delete(key)).to.equal(a);
    expect(a.get(key)).to.equal("défaut");
  });

  it("delete avant tout set ne lève pas", () => {
    expect(() => new GrpcCall(null).delete(key)).not.to.throw();
  });

  it("porte la cible de l'appel", () => {
    const target = {};
    expect(new GrpcCall(target).target).to.equal(target);
  });
});

describe("hasAbort — garde de type du contexte d'appel (critère 57)", () => {
  const service = makeService();
  const method = service.methods[0];

  it("vrai sur le contexte que Connect crée réellement", () => {
    if (method === undefined) throw new Error("méthode absente");
    const ctx = createHandlerContext({
      service,
      method,
      protocolName: "connect",
      requestMethod: "POST",
      url: "http://localhost/x",
    });
    expect(hasAbort(ctx)).to.equal(true);
    if (hasAbort(ctx)) {
      ctx.abort(new Error("arrêt"));
      expect(ctx.signal.aborted, "abort interrompt l'appel").to.equal(true);
    }
  });

  it("faux sur ce même contexte privé d'`abort`", () => {
    if (method === undefined) throw new Error("méthode absente");
    const { abort, ...withoutAbort } = createHandlerContext({
      service,
      method,
      protocolName: "connect",
      requestMethod: "POST",
      url: "http://localhost/x",
    });
    void abort;
    expect(hasAbort(withoutAbort)).to.equal(false);
  });
});

describe("GrpcEndpoint.serve — sur un vrai serveur HTTP/1.1", () => {
  it("Connect JSON : la méthode du contrat répond, sa fiche est une GrpcCall qui porte la cible", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target);
    try {
      const r = await connectJson(srv.url, service, "bonjour");
      expect(r.status).to.equal(200);
      expect(JSON.parse(r.body)).to.deep.equal({ text: "A:bonjour" });
      // La réserve du pipeline est recopiée AVANT que l'adaptateur n'écrive,
      // au type de la requête — et Connect la laisse partir (ADR-0026 D6).
      expect(srv.served[0]?.context.response.commits).to.deep.equal([
        { type: "application/json", headersSent: false },
      ]);
      expect(r.headers.get("x-pipeline")).to.equal("reserve");
      expect(r.headers.get("content-type")).to.equal("application/json");
      const ctx = target.calls[0];
      expect(ctx?.values).to.be.instanceOf(GrpcCall);
      expect(ctx?.values instanceof GrpcCall && ctx.values.target).to.equal(
        target,
      );
    } finally {
      await srv.close();
    }
  });

  it("unaire : contexte marqué répondu, délai de Nodefony GARDÉ, la fiche est l'appel RPC du contexte", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
    );
    try {
      await connectJson(srv.url, service, "x");
      const [rec] = srv.served;
      expect(rec?.socketTimeoutBefore, "armé par le décor").to.equal(30_000);
      expect(rec?.socketTimeoutAfter, "gardé : il terminera l'appel").to.equal(
        30_000,
      );
      expect(rec?.context.sended).to.equal(true);
      expect(rec?.context.rpc).to.be.instanceOf(GrpcCall);
      expect(rec?.error).to.equal(null);
    } finally {
      await srv.close();
    }
  });

  it("flux : délai de Nodefony désarmé (un seul écrivain, aucune échéance)", async () => {
    const service = makeService(true);
    const target = {
      say: (r: { text: string }) => ({ text: r.text }),
      async *watch(): AsyncGenerator<{ text: string }> {
        yield { text: "w" };
      },
    };
    const srv = await serveWith(new GrpcEndpoint(service), () => target);
    try {
      const r = await fetch(`${srv.url}/${service.typeName}/Watch`, {
        method: "POST",
        headers: { "content-type": "application/connect+json" },
        body: envelope(new TextEncoder().encode("{}")),
      });
      await r.arrayBuffer();
      const [rec] = srv.served;
      expect(rec?.socketTimeoutBefore, "armé par le décor").to.equal(30_000);
      expect(rec?.socketTimeoutAfter, "désarmé par serve").to.equal(0);
      expect(rec?.context.rpc).to.be.instanceOf(GrpcCall);
    } finally {
      await srv.close();
    }
  });

  it("flux : cycle de vie d'un flux — place de connexion prise, inscrit au balayage, retiré à la fin (critère 21)", async () => {
    const service = makeService(true);
    const target = {
      say: (r: { text: string }) => ({ text: r.text }),
      async *watch(): AsyncGenerator<{ text: string }> {
        yield { text: "w" };
      },
    };
    const slots: http.ServerResponse[] = [];
    const swept: unknown[] = [];
    const unswept: unknown[] = [];
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      null,
      30_000,
      {
        acquireConnectionSlot: (_req, res) => {
          slots.push(res);
          return true;
        },
        sweepStall: (l) => swept.push(l),
        unsweepStall: (l) => unswept.push(l),
      },
    );
    try {
      const r = await fetch(`${srv.url}/${service.typeName}/Watch`, {
        method: "POST",
        headers: { "content-type": "application/connect+json" },
        body: envelope(new TextEncoder().encode("{}")),
      });
      await r.arrayBuffer();
      await vi.waitFor(() => expect(unswept).to.have.length(1));
      const [rec] = srv.served;
      expect(rec?.error).to.equal(null);
      expect(rec?.context.sended, "réponse prise").to.equal(true);
      expect(slots, "une place de connexion longue").to.have.length(1);
      expect(swept, "inscrit au balayage").to.have.length(1);
      expect(unswept[0], "retiré, le même").to.equal(swept[0]);
    } finally {
      await srv.close();
    }
  });

  it("unaire : aucun cycle de vie de flux — ni place de connexion, ni balayage", async () => {
    const service = makeService();
    let slots = 0;
    let swept = 0;
    const target = new Target("U");
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      null,
      30_000,
      {
        acquireConnectionSlot: () => {
          slots++;
          return true;
        },
        sweepStall: () => {
          swept++;
        },
      },
    );
    try {
      const r = await connectJson(srv.url, service, "u");
      expect(r.status).to.equal(200);
      expect(slots).to.equal(0);
      expect(swept).to.equal(0);
    } finally {
      await srv.close();
    }
  });

  it("flux : plus de place pour cette IP → 429 rendu au pipeline, la méthode n'est pas appelée", async () => {
    const service = makeService(true);
    let called = 0;
    const target = {
      say: (r: { text: string }) => ({ text: r.text }),
      async *watch(): AsyncGenerator<{ text: string }> {
        called++;
        yield { text: "w" };
      },
    };
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      null,
      30_000,
      {
        acquireConnectionSlot: () => false,
      },
    );
    try {
      const r = await fetch(`${srv.url}/${service.typeName}/Watch`, {
        method: "POST",
        headers: { "content-type": "application/connect+json" },
        body: envelope(new TextEncoder().encode("{}")),
      });
      await r.arrayBuffer();
      const [rec] = srv.served;
      expect(rec?.error).to.be.instanceOf(HttpError);
      expect(rec?.error).toMatchObject({ code: 429 });
      expect(rec?.context.sended, "réponse laissée au pipeline").to.equal(
        false,
      );
      expect(called).to.equal(0);
    } finally {
      await srv.close();
    }
  });

  it("singleton : la cible du premier appel sert les suivants, méthodes liées une fois", async () => {
    const service = makeService();
    const targets = [new Target("A"), new Target("B")];
    let i = 0;
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => targets[i++] ?? new Target("?"),
    );
    try {
      expect((await connectJson(srv.url, service, "1")).body).to.contain("A:1");
      expect((await connectJson(srv.url, service, "2")).body).to.contain("A:2");
    } finally {
      await srv.close();
    }
  });

  it('@Scope("request") : chaque appel est servi par SA cible', async () => {
    const service = makeService();
    const targets = [new Target("A"), new Target("B")];
    let i = 0;
    const srv = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => targets[i++] ?? new Target("?"),
    );
    try {
      expect((await connectJson(srv.url, service, "1")).body).to.contain("A:1");
      expect((await connectJson(srv.url, service, "2")).body).to.contain("B:2");
    } finally {
      await srv.close();
    }
  });

  it("une méthode inconnue du contrat : 404 de l'adaptateur, la méthode n'est pas appelée", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target);
    try {
      const r = await fetch(`${srv.url}/${service.typeName}/say`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(r.status).to.equal(404);
      expect(target.calls).to.have.length(0);
      // Témoin : la casse exacte est servie.
      expect((await connectJson(srv.url, service, "x")).status).to.equal(200);
    } finally {
      await srv.close();
    }
  });

  it("une requête sans autorité (HTTP/1.0 sans Host) : 400 rendu au pipeline, réponse non prise", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
    );
    try {
      const status = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(srv.port, "127.0.0.1", () => {
          socket.write(
            `POST ${path(service)} HTTP/1.0\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}`,
          );
        });
        let data = "";
        socket.on("data", (d) => (data += String(d)));
        socket.on("end", () => resolve(data.split("\r\n")[0] ?? ""));
        socket.on("error", reject);
      });
      expect(status).to.match(/ 400 /);
      const [rec] = srv.served;
      expect(rec?.context.sended, "la réponse revient au pipeline").to.equal(
        false,
      );
      expect(rec?.context.logged).to.have.length(1);
    } finally {
      await srv.close();
    }
  });

  it("une réponse déjà partie : 500, l'adaptateur n'est pas appelé", async () => {
    const service = makeService();
    const target = new Target("A");
    const endpoint = new GrpcEndpoint(service);
    const server = http.createServer((req, res) => {
      const context = fakeContext(req, res, null);
      context.sended = true;
      try {
        void endpoint.serve(asHttpContext(context), target);
        res.end("servi");
      } catch (e) {
        res.statusCode =
          e instanceof HttpError && e.code !== null ? e.code : 599;
        res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const r = await connectJson(`http://127.0.0.1:${port}`, service, "x");
      expect(r.status).to.equal(500);
      expect(target.calls).to.have.length(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("GrpcEndpoint — google.protobuf.Any en JSON (registre du contrat)", () => {
  it("un Any qui emballe un type du contrat se lit et s'écrit en JSON", async () => {
    const service = makeAnyService();
    const echo = { say: (request: unknown) => request };
    const srv = await serveWith(new GrpcEndpoint(service), () => echo);
    try {
      const extra = {
        "@type": "type.googleapis.com/nodefony.httptest.v1.Inner",
        label: "emballé",
      };
      const r = await fetch(srv.url + path(service), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extra }),
      });
      expect(r.status, await r.clone().text()).to.equal(200);
      expect(await r.json()).to.deep.equal({ extra });
    } finally {
      await srv.close();
    }
  });
});

describe("GrpcEndpoint — protocoles servis (critère 16, garde de connect-es#1835)", () => {
  it("défaut : les trois protocoles sont servis", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
      { grpc: true, grpcWeb: true, connect: true },
    );
    try {
      expect((await connectJson(srv.url, service, "x")).status).to.equal(200);
      expect(await grpcWeb(srv.url, service)).to.equal(200);
      expect(await grpc(srv.url, service)).to.not.equal(415);
    } finally {
      await srv.close();
    }
  });

  it("gRPC et gRPC-Web coupés : 415 pour eux, Connect toujours servi", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
      { grpc: false, grpcWeb: false, connect: true },
    );
    try {
      expect(await grpc(srv.url, service)).to.equal(415);
      expect(await grpcWeb(srv.url, service)).to.equal(415);
      expect((await connectJson(srv.url, service, "x")).status).to.equal(200);
    } finally {
      await srv.close();
    }
  });

  it("Connect coupé : 415 pour lui, gRPC-Web servi", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
      { grpc: true, grpcWeb: true, connect: false },
    );
    try {
      expect((await connectJson(srv.url, service, "x")).status).to.equal(415);
      expect(await grpcWeb(srv.url, service)).to.equal(200);
    } finally {
      await srv.close();
    }
  });
});

/**
 * `Msg { text }` encodé, de `total` octets exactement : étiquette du champ 1,
 * longueur en varint de 4 octets (texte entre 2 Mio et 256 Mio), texte.
 */
function msgOfSize(total: number): Uint8Array {
  const textLength = total - 5;
  if (textLength < 1 << 21 || textLength >= 1 << 28) {
    throw new Error(
      `msgOfSize : ${total} hors de la plage d'un varint de 4 octets`,
    );
  }
  return msgHead(textLength, new Uint8Array(total));
}

/** Pose l'étiquette et la longueur d'un `Msg` de texte `textLength` dans `out`. */
function msgHead(textLength: number, out: Uint8Array): Uint8Array {
  out[0] = 0x0a;
  let v = textLength;
  for (let i = 1; i < 5; i += 1) {
    out[i] = i < 4 ? (v & 0x7f) | 0x80 : v & 0x7f;
    v >>>= 7;
  }
  out.fill(0x61, 5);
  return out;
}

/** Une enveloppe gRPC-Web : drapeau, longueur sur 32 bits, message. */
function envelope(
  payload: Uint8Array,
  compressed = false,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + payload.length);
  out[0] = compressed ? 1 : 0;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

interface IGrpcWebReply {
  /** Le statut HTTP. */
  httpStatus: number;
  /** Le statut gRPC, lu dans les en-têtes ou dans la trame de trailers. */
  grpcStatus: string | null;
  /** Taille du message de réponse, `-1` sans message. */
  messageBytes: number;
}

/** Un appel gRPC-Web binaire : statut gRPC et taille du message rendu. */
async function grpcWebCall(
  url: string,
  service: DescService,
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
): Promise<IGrpcWebReply> {
  const r = await fetch(url + path(service), {
    method: "POST",
    headers: { "content-type": "application/grpc-web+proto", ...headers },
    body,
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const reply: IGrpcWebReply = {
    httpStatus: r.status,
    grpcStatus: r.headers.get("grpc-status"),
    messageBytes: -1,
  };
  let at = 0;
  while (at + 5 <= bytes.length) {
    const flags = bytes[at] ?? 0;
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + at + 1,
      4,
    ).getUint32(0);
    const data = bytes.subarray(at + 5, at + 5 + length);
    if ((flags & 0x80) !== 0) {
      const status = /grpc-status:\s*(\d+)/i.exec(
        new TextDecoder().decode(data),
      );
      if (status !== null) reply.grpcStatus = status[1] ?? null;
    } else {
      reply.messageBytes = data.length;
    }
    at += 5 + length;
  }
  return reply;
}

/**
 * Bombe gzip : un `Msg` dont le texte décompressé fait `textLength` octets,
 * compressé en flux — le banc lui-même n'alloue jamais la taille décompressée.
 *
 * Niveau le plus rapide : au niveau par défaut, compresser 256 Mio coûte
 * ~0,9 s en local et dépassait le délai de 5 s sur les machines Windows de
 * la CI — le banc mesurait sa propre fabrication. Le niveau 1 coûte 4 fois
 * moins pour un message de ~1,1 Mio, toujours sous la borne filaire : la
 * bombe atteint bien la décompression, seule mise à l'épreuve ici.
 */
async function gzipBomb(textLength: number): Promise<Uint8Array> {
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(gzip, "end");
  gzip.write(msgHead(textLength, new Uint8Array(5)));
  const block = Buffer.alloc(1 << 20, 0x61);
  for (let written = 0; written < textLength; written += block.length) {
    const piece =
      textLength - written >= block.length
        ? block
        : block.subarray(0, textLength - written);
    if (!gzip.write(piece)) await once(gzip, "drain");
  }
  gzip.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

const MIB = 1024 * 1024;

describe("GrpcEndpoint — bornes des messages (critères 18 et 59, ADR-0026 D4)", () => {
  it("4 Mio + 1 reçu : 8 RESOURCE_EXHAUSTED, la méthode n'est pas appelée", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const reply = await grpcWebCall(
        srv.url,
        service,
        envelope(msgOfSize(4 * MIB + 1)),
      );
      expect(reply.grpcStatus).to.equal("8");
      expect(target.calls.length).to.equal(0);
    } finally {
      await srv.close();
    }
  });

  it("4 Mio exactement : lu et servi ; l'écho, 2 octets de plus, est refusé à l'émission (8)", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const reply = await grpcWebCall(
        srv.url,
        service,
        envelope(msgOfSize(4 * MIB)),
      );
      expect(target.calls.length).to.equal(1);
      expect(reply.grpcStatus).to.equal("8");
      expect(reply.messageBytes).to.equal(-1);
    } finally {
      await srv.close();
    }
  });

  it("bombe gzip (256 Mio décompressés) : 8, méthode non appelée, pic mémoire borné", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const bomb = await gzipBomb(256 * MIB);
      // Pic de mémoire résidente du process (Kio) : la décompression bornée
      // s'arrête à 4 Mio, sans borne elle irait jusqu'à 256 Mio.
      const peakBefore = process.resourceUsage().maxRSS;
      const reply = await grpcWebCall(srv.url, service, envelope(bomb, true), {
        "grpc-encoding": "gzip",
      });
      const peakGrowthMib =
        (process.resourceUsage().maxRSS - peakBefore) / 1024;
      expect(reply.grpcStatus).to.equal("8");
      expect(target.calls.length).to.equal(0);
      expect(peakGrowthMib).to.be.below(64);
    } finally {
      await srv.close();
    }
  });

  it("bornes réglées à 8 Mio : un message de 5 Mio passe, et son écho revient", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {
      readMaxBytes: 8 * MIB,
      writeMaxBytes: 8 * MIB,
    });
    try {
      const reply = await grpcWebCall(
        srv.url,
        service,
        envelope(msgOfSize(5 * MIB)),
      );
      expect(reply.grpcStatus).to.equal("0");
      expect(reply.messageBytes).to.equal(5 * MIB + 2);
      expect(target.calls.length).to.equal(1);
    } finally {
      await srv.close();
    }
  });

  it("bornes par défaut : le même message de 5 Mio est refusé en 8", async () => {
    const service = makeService();
    const target = new Target("A");
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const reply = await grpcWebCall(
        srv.url,
        service,
        envelope(msgOfSize(5 * MIB)),
      );
      expect(reply.grpcStatus).to.equal("8");
      expect(target.calls.length).to.equal(0);
    } finally {
      await srv.close();
    }
  });
});

/**
 * Une cible SOURDE : retient l'échéance vue à l'appel et l'interruption de
 * `ctx.signal`, puis ne répond jamais — sans lire le signal.
 */
class StallTarget {
  ctx: HandlerContext | null = null;
  timeoutAtCall: number | undefined = undefined;
  aborted = false;
  say(
    _request: { text: string },
    ctx: HandlerContext,
  ): Promise<{ text: string }> {
    this.ctx = ctx;
    this.timeoutAtCall = ctx.timeoutMs();
    ctx.signal.addEventListener("abort", () => {
      this.aborted = true;
    });
    return new Promise(() => {});
  }
}

/** Une cible asynchrone qui répond : le filet laisse passer sa réponse. */
class AsyncTarget {
  timeoutAtCall: number | undefined = undefined;
  async say(
    request: { text: string },
    ctx: HandlerContext,
  ): Promise<{ text: string }> {
    this.timeoutAtCall = ctx.timeoutMs();
    await new Promise((resolve) => setImmediate(resolve));
    return { text: `async:${request.text}` };
  }
}

/** Corps vide de `Msg` en gRPC-Web. */
const EMPTY = new Uint8Array([0, 0, 0, 0, 0]);

describe("GrpcEndpoint — échéance d'un appel unaire (critères 19 et 20, ADR-0026 D4)", () => {
  it("sans échéance du client, gestionnaire sourd : 4 DEADLINE_EXCEEDED au délai de réponse, jamais le 504 de Nodefony, signal interrompu", async () => {
    const service = makeService();
    const target = new StallTarget();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      {},
      200,
    );
    try {
      const reply = await grpcWebCall(srv.url, service, EMPTY);
      expect(reply.httpStatus).to.equal(200);
      expect(reply.grpcStatus).to.equal("4");
      expect(target.aborted).to.equal(true);
      // `ctx.timeoutMs()` rend l'échéance DU CLIENT, ici aucune : le délai du
      // serveur n'est pas déguisé en échéance reçue (conformité de Connect).
      expect(target.timeoutAtCall).to.equal(undefined);
      expect(target.ctx?.values).to.be.instanceOf(GrpcCall);
    } finally {
      await srv.close();
    }
  });

  it("Connect JSON : même échéance, rendue au format de Connect", async () => {
    const service = makeService();
    const target = new StallTarget();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      {},
      200,
    );
    try {
      const { body } = await connectJson(srv.url, service, "x");
      expect(JSON.parse(body)).to.include({ code: "deadline_exceeded" });
      expect(target.aborted).to.equal(true);
    } finally {
      await srv.close();
    }
  });

  it("client à 120 s : l'appel finit au délai de réponse, jamais INVALID_ARGUMENT ; le gestionnaire voit l'échéance du client", async () => {
    const service = makeService();
    const target = new StallTarget();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      {},
      200,
    );
    try {
      const reply = await grpcWebCall(srv.url, service, EMPTY, {
        "grpc-timeout": "120S",
      });
      expect(reply.grpcStatus).to.equal("4");
      expect(target.aborted).to.equal(true);
      expect(target.timeoutAtCall).to.be.within(119_000, 120_000);
    } finally {
      await srv.close();
    }
  });

  it("client plus court que le délai : son échéance est gardée", async () => {
    const service = makeService();
    const target = new AsyncTarget();
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const reply = await grpcWebCall(srv.url, service, EMPTY, {
        "grpc-timeout": "5000m",
      });
      expect(reply.grpcStatus).to.equal("0");
      expect(target.timeoutAtCall).to.be.within(1, 5000);
    } finally {
      await srv.close();
    }
  });

  it("Connect, client à 120 s : l'appel finit au délai de réponse", async () => {
    const service = makeService();
    const target = new StallTarget();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      {},
      200,
    );
    try {
      const r = await fetch(srv.url + path(service), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "connect-timeout-ms": "120000",
        },
        body: JSON.stringify({ text: "x" }),
      });
      expect(await r.json()).to.include({ code: "deadline_exceeded" });
      expect(target.aborted).to.equal(true);
      expect(target.timeoutAtCall).to.be.within(119_000, 120_000);
    } finally {
      await srv.close();
    }
  });

  it("échéance malformée : laissée à l'adaptateur, qui la refuse en 3 INVALID_ARGUMENT", async () => {
    const service = makeService();
    const target = new AsyncTarget();
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {});
    try {
      const reply = await grpcWebCall(srv.url, service, EMPTY, {
        "grpc-timeout": "bientôt",
      });
      expect(reply.grpcStatus).to.equal("3");
      expect(target.timeoutAtCall).to.equal(undefined);
    } finally {
      await srv.close();
    }
  });

  it("client plus court, gestionnaire sourd : signal interrompu à SON échéance, appel terminé en 4 au plus tard au délai du serveur", async () => {
    const service = makeService();
    const target = new StallTarget();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => target,
      {},
      400,
    );
    try {
      const pending = grpcWebCall(srv.url, service, EMPTY, {
        "grpc-timeout": "50m",
      });
      // L'échéance du client (50 ms) abaisse le signal bien avant le délai
      // du serveur (400 ms) : attendre ce FAIT, jamais une durée.
      await new Promise<void>((resolve) => {
        const poll = (): void => {
          if (target.aborted) resolve();
          else setTimeout(poll, 5);
        };
        poll();
      });
      const reply = await pending;
      expect(reply.grpcStatus).to.equal("4");
    } finally {
      await srv.close();
    }
  });

  it("gestionnaire asynchrone qui répond : sa réponse passe le filet", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new AsyncTarget(),
      {},
    );
    try {
      const { status, body } = await connectJson(srv.url, service, "x");
      expect(status).to.equal(200);
      expect(JSON.parse(body)).to.deep.equal({ text: "async:x" });
    } finally {
      await srv.close();
    }
  });

  it("délai de réponse 0 (désactivé) : aucune échéance posée", async () => {
    const service = makeService();
    const target = new AsyncTarget();
    const srv = await serveWith(new GrpcEndpoint(service), () => target, {}, 0);
    try {
      expect((await connectJson(srv.url, service, "x")).status).to.equal(200);
      expect(target.timeoutAtCall).to.equal(undefined);
    } finally {
      await srv.close();
    }
  });
});

// ─── Erreurs de l'application (critères 32 et 56, ADR-0026 D7) ──────────────
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `translateError` → `return error` (tout redevient 13) ;
//   - `invoke` : le `catch` (l'erreur synchrone redevient 13) ;
//   - `settleUnary` : `reject(error)` au lieu de la traduction ;
//   - `translateSettled` / `translateFirst` : rendre la source telle quelle ;
//   - `FirstMessageTranslator.next` : traduire AUSSI après le premier message ;
//   - `FirstMessageTranslator.return` ET `.throw` : ne plus déléguer à la source
//     (le `finally` ne court plus ; chacun seul est rattrapé par l'autre).

/** Une enveloppe Connect en flux : drapeaux, longueur, JSON. */
function connectEnvelope(message: object): Uint8Array<ArrayBuffer> {
  const data = new TextEncoder().encode(JSON.stringify(message));
  const out = new Uint8Array(5 + data.length);
  new DataView(out.buffer).setUint32(1, data.length);
  out.set(data, 5);
  return out;
}

interface IConnectError {
  code?: string;
  message?: string;
}

/** Lit un `Error` de Connect (`code`, `message`) dans un JSON reçu. */
function readConnectError(value: unknown): IConnectError {
  const error: IConnectError = {};
  if (typeof value !== "object" || value === null) return error;
  const code: unknown = Reflect.get(value, "code");
  const message: unknown = Reflect.get(value, "message");
  if (typeof code === "string") error.code = code;
  if (typeof message === "string") error.message = message;
  return error;
}

/** Un appel unaire Connect JSON : statut HTTP et corps `Error`. */
async function connectUnary(
  url: string,
  service: DescService,
): Promise<{ status: number; error: IConnectError }> {
  const r = await connectJson(url, service, "x");
  const body: unknown = JSON.parse(r.body);
  return { status: r.status, error: readConnectError(body) };
}

/** Un appel Connect en flux : messages reçus et erreur du message de fin. */
async function connectStream(
  url: string,
  service: DescService,
  method: string,
  messages: object[],
): Promise<{ messages: unknown[]; error: IConnectError | null }> {
  const chunks = messages.map(connectEnvelope);
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const r = await fetch(`${url}/${service.typeName}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/connect+json" },
    body,
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const received: unknown[] = [];
  let error: IConnectError | null = null;
  let at = 0;
  while (at + 5 <= bytes.length) {
    const flags = bytes[at] ?? 0;
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + at + 1,
      4,
    ).getUint32(0);
    const json: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(at + 5, at + 5 + length)),
    );
    if ((flags & 0x02) !== 0) {
      const end: unknown =
        typeof json === "object" && json !== null
          ? Reflect.get(json, "error")
          : undefined;
      error = end === undefined ? null : readConnectError(end);
    } else {
      received.push(json);
    }
    at += 5 + length;
  }
  return { messages: received, error };
}

describe("GrpcEndpoint — erreurs de l'application (critères 32 et 56, ADR-0026 D7)", () => {
  afterEach(() => {
    fakeUser = null;
  });

  /** Sert `target` sur un serveur neuf, rend la réponse unaire Connect. */
  async function unaryWith(
    target: object,
  ): Promise<{ status: number; error: IConnectError }> {
    const service = makeService();
    const server = await serveWith(new GrpcEndpoint(service), () => target);
    try {
      return await connectUnary(server.url, service);
    } finally {
      await server.close();
    }
  }

  it("unaire : une HttpError 404 levée de façon synchrone → 5 not_found, son message", async () => {
    const r = await unaryWith({
      say() {
        throw new HttpError("entité introuvable", 404);
      },
    });
    expect(r.status).to.equal(404);
    expect(r.error).to.deep.equal({
      code: "not_found",
      message: "entité introuvable",
    });
  });

  it("unaire : la même, rejetée par un gestionnaire asynchrone → 5", async () => {
    const r = await unaryWith({
      async say() {
        await Promise.resolve();
        throw new HttpError("entité introuvable", 404);
      },
    });
    expect(r.error.code).to.equal("not_found");
  });

  it("unaire : une exception banale → 13 ; en développement son message est servi (même règle que HTTP)", async () => {
    const r = await unaryWith({
      say() {
        throw new Error("base injoignable");
      },
    });
    expect(r.status).to.equal(500);
    expect(r.error).to.deep.equal({
      code: "internal",
      message: "base injoignable",
    });
  });

  it("unaire : en PRODUCTION, la même → 13 opaque, la cause ne quitte pas le serveur", async () => {
    const previous: unknown = Nodefony.getKernel();
    const setKernel = (k: unknown): void =>
      (Nodefony as unknown as { setKernel(k: unknown): void }).setKernel(k);
    setKernel({ environment: "production" });
    try {
      const r = await unaryWith({
        say() {
          throw new Error("base injoignable : 10.0.0.7 table users_secret");
        },
      });
      expect(r.error).to.deep.equal({
        code: "internal",
        message: "Internal Server Error",
      });
    } finally {
      setKernel(previous);
    }
  });

  it("unaire : un code numérique (409) garde son sens → 10 aborted", async () => {
    const r = await unaryWith({
      say() {
        throw Object.assign(new Error("conflit de version"), { code: 409 });
      },
    });
    expect(r.error).to.deep.equal({
      code: "aborted",
      message: "conflit de version",
    });
  });

  it("unaire : une ConnectError passe telle quelle (son code est voulu)", async () => {
    const r = await unaryWith({
      say() {
        throw new ConnectError("déjà là", Code.AlreadyExists);
      },
    });
    expect(r.error.code).to.equal("already_exists");
  });

  it("unaire : 403 sans identité → 16 unauthenticated ; identifié → 7 permission_denied (D5)", async () => {
    const target = {
      say() {
        throw new HttpError("refusé", 403);
      },
    };
    expect((await unaryWith(target)).error.code).to.equal("unauthenticated");
    fakeUser = { id: 1 };
    expect((await unaryWith(target)).error.code).to.equal("permission_denied");
  });

  it("flux serveur : une HttpError AVANT le premier message → 5", async () => {
    const service = makeService(true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        // Lève avant tout `yield` (validation, entité absente) : le cas de D7.
        async *watch(request: { text: string }) {
          await Promise.resolve();
          if (request.text === "x") {
            throw new HttpError("entité introuvable", 404);
          }
          yield request;
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Watch", [
        { text: "x" },
      ]);
      expect(r.messages).to.have.length(0);
      expect(r.error).to.deep.equal({
        code: "not_found",
        message: "entité introuvable",
      });
    } finally {
      await server.close();
    }
  });

  it("flux serveur : APRÈS le premier message, la même erreur → 13 (borne de D7 point 3)", async () => {
    const service = makeService(true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        async *watch() {
          yield { text: "un" };
          throw new HttpError("entité introuvable", 404);
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Watch", [
        { text: "x" },
      ]);
      expect(r.messages).to.deep.equal([{ text: "un" }]);
      expect(r.error?.code).to.equal("internal");
    } finally {
      await server.close();
    }
  });

  it("flux client : une HttpError 400 après lecture des messages → 3 invalid_argument", async () => {
    const service = makeService(true, true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        async collect(requests: AsyncIterable<unknown>) {
          for await (const _ of requests) {
            // tout lire
          }
          throw new HttpError("lot incomplet", 400);
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Collect", [
        { text: "a" },
        { text: "b" },
      ]);
      expect(r.error).to.deep.equal({
        code: "invalid_argument",
        message: "lot incomplet",
      });
    } finally {
      await server.close();
    }
  });

  it("flux serveur : un client qui part → le `finally` du gestionnaire s'exécute (return délégué)", async () => {
    const service = makeService(true);
    let finished: () => void = () => undefined;
    const finallyRan = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        // Sourd à son signal : seul un `return` délégué le fait sortir.
        async *watch() {
          try {
            for (;;) {
              yield { text: "tic" };
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          } finally {
            finished();
          }
        },
      }),
    );
    try {
      const abort = new AbortController();
      const r = await fetch(`${server.url}/${service.typeName}/Watch`, {
        method: "POST",
        headers: { "content-type": "application/connect+json" },
        body: connectEnvelope({ text: "x" }),
        signal: abort.signal,
      });
      const reader = r.body?.getReader();
      await reader?.read();
      abort.abort();
      await finallyRan;
    } finally {
      await server.close();
    }
  });
});

describe("GrpcCall — révocation de l'identité (critère 31, ADR-0026 D6)", () => {
  const service = makeService();
  const method = service.methods[0];
  const handlerContext = () => {
    if (method === undefined) throw new Error("méthode absente");
    return createHandlerContext({
      service,
      method,
      protocolName: "grpc",
      requestMethod: "POST",
      url: "http://localhost/x",
    });
  };

  it("réponse unique suivie : rejet 16, signal abaissé avec la même raison", () => {
    const call = new GrpcCall(null);
    const ctx = handlerContext();
    const reasons: unknown[] = [];
    call.attach(ctx, (reason) => reasons.push(reason));
    call.revoke();
    const reason = reasons[0];
    expect(reason).to.be.instanceOf(ConnectError);
    expect(reason instanceof ConnectError && reason.code).to.equal(
      Code.Unauthenticated,
    );
    expect(ctx.signal.reason).to.equal(reason);
    expect(call.interruption).to.equal(reason);
  });

  it("révoquée AVANT que le gestionnaire ne démarre : rejetée dès qu'il est suivi", () => {
    const call = new GrpcCall(null);
    call.revoke();
    const reasons: unknown[] = [];
    call.attach(handlerContext(), (reason) => reasons.push(reason));
    expect(reasons).to.have.length(1);
  });

  it("la première cause gagne : échue puis révoquée → 4, un seul rejet", () => {
    const call = new GrpcCall(null);
    const reasons: unknown[] = [];
    call.attach(handlerContext(), (reason) => reasons.push(reason));
    call.expire();
    call.revoke();
    expect(reasons).to.have.length(1);
    expect(call.interruption?.code).to.equal(Code.DeadlineExceeded);
  });

  it("flux suivi : le signal s'abaisse en 16, l'interruption est lisible", () => {
    const call = new GrpcCall(null);
    const ctx = handlerContext();
    call.follow(ctx);
    expect(call.interruption).to.equal(null);
    call.revoke();
    expect(ctx.signal.aborted).to.equal(true);
    expect(call.interruption?.code).to.equal(Code.Unauthenticated);
  });
});

describe("GrpcEndpoint — appel révoqué en cours (critère 31, ADR-0026 D6)", () => {
  /** Révoque l'appel du contexte comme le registre du noyau le ferait. */
  const revoke = (ctx: { values: unknown }): void => {
    if (ctx.values instanceof GrpcCall) ctx.values.revoke();
  };

  it("flux serveur SOURD qui produit : 16 au message suivant, au plus le message en vol, `finally` exécuté", async () => {
    const service = makeService(true);
    const state = { finished: false };
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        // Ignore son signal ; fini (50 messages) pour qu'un débranchement se
        // lise en échec, jamais en délai dépassé.
        async *watch(_request: unknown, ctx: { values: unknown }) {
          try {
            for (let i = 0; i < 50; i++) {
              if (i === 3) revoke(ctx);
              yield { text: String(i) };
            }
          } finally {
            state.finished = true;
          }
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Watch", [
        { text: "x" },
      ]);
      // 0, 1, 2 avant la révocation ; 3 était déjà en vol.
      expect(r.messages).to.deep.equal([
        { text: "0" },
        { text: "1" },
        { text: "2" },
        { text: "3" },
      ]);
      expect(r.error).to.deep.equal({
        code: "unauthenticated",
        message: "identité révoquée",
      });
      expect(state.finished, "le gestionnaire est refermé").to.equal(true);
    } finally {
      await server.close();
    }
  });

  it("flux serveur qui ÉCOUTE son signal : il lit la raison 16 et la lève", async () => {
    const service = makeService(true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        async *watch(
          _request: unknown,
          ctx: { values: unknown; signal: AbortSignal },
        ) {
          yield { text: "un" };
          setTimeout(() => revoke(ctx), 5);
          await new Promise<void>((resolve) =>
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          throw ctx.signal.reason;
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Watch", [
        { text: "x" },
      ]);
      expect(r.messages).to.deep.equal([{ text: "un" }]);
      expect(r.error?.code).to.equal("unauthenticated");
    } finally {
      await server.close();
    }
  });

  it("flux client révoqué, gestionnaire SOURD qui ne rend jamais : 16 sans l'attendre", async () => {
    const service = makeService(true, true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => ({
        async collect(
          requests: AsyncIterable<unknown>,
          ctx: { values: unknown },
        ) {
          for await (const _ of requests) {
            // tout lire
          }
          revoke(ctx);
          return new Promise<never>(() => undefined);
        },
      }),
    );
    try {
      const r = await connectStream(server.url, service, "Collect", [
        { text: "a" },
      ]);
      expect(r.error?.code).to.equal("unauthenticated");
    } finally {
      await server.close();
    }
  });
});

describe("GrpcCall.settle — code de l'appel lu au close (critères 36 et 37, ADR-0026 D10)", () => {
  /**
   * Sert `target` sur un serveur neuf, joue `call`, puis attend le `close` de
   * la réponse : rend ce que le noyau y a fixé.
   */
  async function settledWith(
    target: object,
    call: (url: string, service: DescService) => Promise<unknown>,
    options: { stream?: boolean; responseTimeout?: number } = {},
  ): Promise<{ settled: ISettled | null; service: DescService }> {
    const service = makeService(options.stream === true);
    const server = await serveWith(
      new GrpcEndpoint(service, { perCall: true }),
      () => target,
      null,
      options.responseTimeout ?? 30_000,
    );
    try {
      await call(server.url, service).catch(() => undefined);
      const served = server.served[0];
      if (served === undefined) throw new Error("aucune requête servie");
      await served.closed;
      return { settled: served.settled, service };
    } finally {
      await server.close();
    }
  }

  const unary = (url: string, service: DescService) =>
    connectJson(url, service, "x");

  it("unaire réussi : 0 OK, système `connect`, méthode tirée de la route, aucune cause", async () => {
    const { settled, service } = await settledWith(
      { say: (request: { text: string }) => request },
      unary,
    );
    expect(settled).to.deep.equal({
      system: "connect",
      method: `${service.typeName}/Say`,
      code: 0,
      codeName: "OK",
      cause: null,
      ended: true,
    });
  });

  it("gRPC-Web : le système est celui du fil", async () => {
    const { settled } = await settledWith(
      { say: (request: { text: string }) => request },
      (url, service) => grpcWebCall(url, service, envelope(new Uint8Array(0))),
    );
    expect(settled?.system).to.equal("grpc-web");
    expect(settled?.code).to.equal(0);
  });

  it("une ConnectError : son code, aucune cause (le code est voulu)", async () => {
    const { settled } = await settledWith(
      {
        say() {
          throw new ConnectError("déjà là", Code.AlreadyExists);
        },
      },
      unary,
    );
    expect(settled?.code).to.equal(6);
    expect(settled?.codeName).to.equal("ALREADY_EXISTS");
    expect(settled?.cause).to.equal(null);
  });

  it("une exception banale : 13, et la cause part à la ligne d'accès (D7 point 4)", async () => {
    const failure = new Error("base injoignable");
    const { settled } = await settledWith(
      {
        say() {
          throw failure;
        },
      },
      unary,
    );
    expect(settled?.code).to.equal(13);
    expect(settled?.codeName).to.equal("INTERNAL");
    expect(settled?.cause).to.equal(failure);
  });

  it("une HttpError 404 traduite : 5 NOT_FOUND, sa cause est l'HttpError", async () => {
    const failure = new HttpError("entité introuvable", 404);
    const { settled } = await settledWith(
      {
        say() {
          throw failure;
        },
      },
      unary,
    );
    expect(settled?.code).to.equal(5);
    expect(settled?.cause).to.equal(failure);
  });

  it("une valeur qui n'est pas une Error : 13, enveloppée dans une Error qui la garde en cause", async () => {
    const { settled } = await settledWith(
      {
        say() {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- le cas éprouvé
          throw "panne texte";
        },
      },
      unary,
    );
    expect(settled?.code).to.equal(13);
    expect(settled?.cause).to.be.instanceOf(Error);
    expect(settled?.cause?.cause).to.equal("panne texte");
  });

  it("refusé par l'adaptateur AVANT le gestionnaire (bombe gzip) : 8, pas 0 — le gestionnaire ne l'a jamais vu", async () => {
    const target = new Target("A");
    const bomb = await gzipBomb(16 * MIB);
    const { settled } = await settledWith(target, (url, service) =>
      grpcWebCall(url, service, envelope(bomb, true), {
        "grpc-encoding": "gzip",
      }),
    );
    expect(target.calls.length).to.equal(0);
    expect(settled?.code).to.equal(8);
    expect(settled?.codeName).to.equal("RESOURCE_EXHAUSTED");
  });

  it("délai de réponse échu : 4 DEADLINE_EXCEEDED", async () => {
    const { settled } = await settledWith(
      { say: () => new Promise<never>(() => {}) },
      unary,
      { responseTimeout: 50 },
    );
    expect(settled?.code).to.equal(4);
    expect(settled?.cause).to.equal(null);
  });

  it("client parti pendant un appel unaire : 1 CANCELLED, réponse non finie", async () => {
    const { settled } = await settledWith(
      { say: () => new Promise<never>(() => {}) },
      async (url, service) => {
        const abort = new AbortController();
        setTimeout(() => abort.abort(), 50);
        await fetch(url + path(service), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: abort.signal,
        });
      },
    );
    expect(settled?.ended).to.equal(false);
    expect(settled?.code).to.equal(1);
    expect(settled?.codeName).to.equal("CANCELLED");
  });

  it("flux serveur fini normalement : 0", async () => {
    const { settled } = await settledWith(
      {
        async *watch() {
          yield { text: "un" };
        },
      },
      (url, service) => connectStream(url, service, "Watch", [{ text: "x" }]),
      { stream: true },
    );
    expect(settled?.code).to.equal(0);
  });

  it("flux serveur dont le client part : 1", async () => {
    const { settled } = await settledWith(
      {
        async *watch() {
          for (;;) {
            yield { text: "tic" };
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        },
      },
      async (url, service) => {
        const abort = new AbortController();
        const r = await fetch(`${url}/${service.typeName}/Watch`, {
          method: "POST",
          headers: { "content-type": "application/connect+json" },
          body: connectEnvelope({ text: "x" }),
          signal: abort.signal,
        });
        await r.body?.getReader().read();
        abort.abort();
      },
      { stream: true },
    );
    expect(settled?.code).to.equal(1);
  });

  it("fixé UNE fois : un second appel ne change rien et ne rend aucune cause", async () => {
    const failure = new Error("panne");
    const service = makeService();
    const server = await serveWith(new GrpcEndpoint(service), () => ({
      say() {
        throw failure;
      },
    }));
    try {
      await connectJson(server.url, service, "x");
      const served = server.served[0];
      await served?.closed;
      const rpc = served?.context.rpc ?? null;
      expect(rpc?.code).to.equal(13);
      expect(rpc?.settle(true)).to.equal(null);
      expect(rpc?.code).to.equal(13);
    } finally {
      await server.close();
    }
  });

  it("une fiche dont l'appel n'a jamais commencé : code et nom null", () => {
    const call = new GrpcCall(null);
    expect(call.settle(true)).to.equal(null);
    expect(call.code).to.equal(null);
    expect(call.codeName).to.equal(null);
  });
});

describe("GrpcCall.settle — réponse non finie : le client est parti (critère 37)", () => {
  const service = makeService();
  const method = service.methods[0];

  /** Un contexte d'appel RÉEL de Connect, dont la requête s'est fermée sur `reason`. */
  function closedWith(reason: unknown, timeoutMs?: number): GrpcCall {
    if (method === undefined) throw new Error("méthode introuvable");
    const call = new GrpcCall(null);
    call.open(
      createHandlerContext({
        service,
        method,
        protocolName: "grpc",
        requestMethod: "POST",
        url: "http://localhost/x",
        requestSignal: AbortSignal.abort(reason),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    );
    return call;
  }

  it("RST_STREAM INTERNAL_ERROR du client (connect-node à son échéance) : 1, jamais 13", () => {
    const call = closedWith(
      new ConnectError(
        "http/2 stream closed with error code INTERNAL_ERROR (0x2)",
        Code.Internal,
      ),
    );
    expect(call.settle(false)).to.equal(null);
    expect(call.code).to.equal(1);
  });

  it("ECONNRESET en HTTP/1.1 (Aborted, cause Node) : 1, la cause ne part pas à la ligne", () => {
    const call = closedWith(
      Object.assign(new ConnectError("reset", Code.Aborted), {
        cause: new Error("ECONNRESET"),
      }),
    );
    expect(call.settle(false)).to.equal(null);
    expect(call.code).to.equal(1);
  });

  it("échéance du serveur, réponse non finie : 4 garde son code", () => {
    const call = closedWith(
      new ConnectError("the operation timed out", Code.DeadlineExceeded),
    );
    call.settle(false);
    expect(call.code).to.equal(4);
  });

  it("identité révoquée, transport détruit (réponse non finie) : 16 garde son code", () => {
    if (method === undefined) throw new Error("méthode introuvable");
    const call = new GrpcCall(null);
    call.revoke();
    const ctx = createHandlerContext({
      service,
      method,
      protocolName: "grpc",
      requestMethod: "POST",
      url: "http://localhost/x",
    });
    // Le flux suit son contexte : l'interruption l'abaisse avec SA raison.
    call.follow(ctx);
    call.open(ctx);
    call.settle(false);
    expect(call.code).to.equal(16);
  });

  it("réponse FINIE : la ConnectError garde son code (13 voulu)", () => {
    const call = closedWith(new ConnectError("panne", Code.Internal));
    call.settle(true);
    expect(call.code).to.equal(13);
  });
});

describe("GrpcEndpoint — CORS d'une réponse RPC (critère 35, ADR-0026 D9 point 3)", () => {
  /** Sert un appel unaire avec la réserve donnée ; rend la réserve après la remise. */
  async function reserveAfterCall(
    reserve: Record<string, string>,
  ): Promise<Map<string, string>> {
    const service = makeService();
    const server = await serveWith(
      new GrpcEndpoint(service),
      () => ({ say: (request: { text: string }) => request }),
      null,
      30_000,
      null,
      reserve,
    );
    try {
      await connectJson(server.url, service, "x");
      const served = server.served[0];
      if (served === undefined) throw new Error("aucune requête servie");
      return served.context.response.reserve;
    } finally {
      await server.close();
    }
  }

  it("origine autorisée : statut, message, détails et encodage exposés au script", async () => {
    const reserve = await reserveAfterCall({
      "access-control-allow-origin": "https://app.example",
    });
    expect(reserve.get("access-control-expose-headers")).to.equal(
      "Grpc-Status, Grpc-Message, Grpc-Status-Details-Bin, Content-Encoding, Connect-Content-Encoding",
    );
  });

  it("la liste de l'application est gardée, celle des RPC s'y ajoute", async () => {
    const reserve = await reserveAfterCall({
      "access-control-allow-origin": "https://app.example",
      "access-control-expose-headers": "X-Total-Count",
    });
    expect(reserve.get("access-control-expose-headers")).to.match(
      /^X-Total-Count, Grpc-Status, /,
    );
  });

  it("requête sans origine autorisée : rien n'est exposé", async () => {
    const reserve = await reserveAfterCall({});
    expect(reserve.has("access-control-expose-headers")).to.equal(false);
  });
});
