/// <reference types="node" />
//
// ─── @nodefony/http/grpc : fiche d'appel, garde `abort`, point d'entrée (#695) ──
//
// ADR-0026 D3 (protocoles), D4 (un seul écrivain), D6 (fiche d'appel). Le point
// d'entrée est éprouvé sur un VRAI serveur `node:http`, l'adaptateur Connect
// réel derrière : seul le contexte Nodefony est factice (ce qu'il lit est
// petit et nommé ci-dessous).
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `hasAbort` → `return true` ;
//   - `GrpcEndpoint.#build` : les options `grpc` / `grpcWeb` / `connect` ;
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
  type IGrpcProtocols,
} from "../../grpc/index";
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
function makeService(): DescService {
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
  response: { response: http.ServerResponse; isHeaderSent(): boolean };
  request: { request: http.IncomingMessage };
  httpKernel: { options: { grpc: IGrpcProtocols } } | null;
  logged: unknown[];
  log(error: unknown): void;
}

function fakeContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  protocols: IGrpcProtocols | null,
): IFakeContext {
  return {
    sended: false,
    finished: false,
    response: { response: res, isHeaderSent: () => res.headersSent },
    request: { request: req },
    httpKernel: protocols === null ? null : { options: { grpc: protocols } },
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
  protocols: IGrpcProtocols | null = null,
): Promise<{
  url: string;
  port: number;
  served: IServed[];
  close(): Promise<void>;
}> {
  const served: IServed[] = [];
  const server = http.createServer((req, res) => {
    // Le délai que Nodefony arme sur toute requête (`HttpContext.setTimeout`).
    res.socket?.setTimeout(30_000);
    const context = fakeContext(req, res, protocols);
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

  it("le contexte est marqué répondu et le délai de Nodefony désarmé (un seul écrivain)", async () => {
    const service = makeService();
    const srv = await serveWith(
      new GrpcEndpoint(service),
      () => new Target("A"),
    );
    try {
      await connectJson(srv.url, service, "x");
      const [rec] = srv.served;
      expect(rec?.socketTimeoutBefore, "armé par le décor").to.equal(30_000);
      expect(rec?.socketTimeoutAfter, "désarmé par serve").to.equal(0);
      expect(rec?.context.sended).to.equal(true);
      expect(rec?.error).to.equal(null);
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
