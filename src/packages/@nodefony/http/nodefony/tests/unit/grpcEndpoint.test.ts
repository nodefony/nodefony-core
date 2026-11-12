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
import { expect } from "vitest";
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
function makeService(withStream = false): DescService {
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
  };
  request: { request: http.IncomingMessage; url: URL };
  /** L'appel RPC du contexte (`HttpContext.rpc`), posé par `serve`. */
  rpc: IRpcCall | null;
  httpKernel: { options: { grpc: IGrpcSettings } } | null;
  logged: unknown[];
  log(error: unknown): void;
}

/** La section `grpc` telle que Zod la rend : tous les champs, défauts compris. */
const SETTINGS: IGrpcSettings = {
  grpc: true,
  grpcWeb: true,
  connect: true,
  readMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  writeMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  requireConnectProtocolHeader: false,
};

function fakeContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  settings: Partial<IGrpcSettings> | null,
  responseTimeout = 30_000,
): IFakeContext {
  return {
    sended: false,
    finished: false,
    response: {
      response: res,
      isHeaderSent: () => res.headersSent,
      timeout: responseTimeout,
    },
    request: { request: req, url: new URL(req.url ?? "/", "http://localhost") },
    rpc: null,
    httpKernel:
      settings === null
        ? null
        : { options: { grpc: { ...SETTINGS, ...settings } } },
    logged: [],
    log(error) {
      this.logged.push(error);
    },
  };
}

const asHttpContext = (c: IFakeContext): HttpContext =>
  c as unknown as HttpContext;

interface IServed {
  context: IFakeContext;
  error: unknown;
  socketTimeoutBefore: number | undefined;
  socketTimeoutAfter: number | undefined;
}

/** Un serveur dont chaque requête passe par `endpoint.serve`. */
async function serveWith(
  endpoint: GrpcEndpoint,
  pickTarget: () => object,
  settings: Partial<IGrpcSettings> | null = null,
  responseTimeout = 30_000,
): Promise<{
  url: string;
  port: number;
  served: IServed[];
  close(): Promise<void>;
}> {
  const served: IServed[] = [];
  const server = http.createServer((req, res) => {
    const context = fakeContext(req, res, settings, responseTimeout);
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
    const record: IServed = {
      context,
      error: null,
      socketTimeoutBefore: res.socket?.timeout,
      socketTimeoutAfter: undefined,
    };
    served.push(record);
    try {
      endpoint.serve(asHttpContext(context), pickTarget());
    } catch (e) {
      record.error = e;
      res.statusCode = e instanceof HttpError && e.code !== null ? e.code : 599;
      res.end();
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
): Promise<{ status: number; body: string }> {
  const r = await fetch(url + path(service), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { status: r.status, body: await r.text() };
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
        endpoint.serve(asHttpContext(context), target);
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
 */
async function gzipBomb(textLength: number): Promise<Uint8Array> {
  const gzip = zlib.createGzip();
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
