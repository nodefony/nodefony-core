/// <reference types="node" />
/**
 * Routes à schéma (ADR-0018) — à travers le VRAI pipeline, HTTP ET pont
 * WebSocket `api.request`.
 *
 * Ce que l'unitaire ne peut pas voir : que le Resolver valide AVANT l'action
 * sur un contexte réel, que le 422 a la même forme sur les deux transports, et
 * que le pont lit le corps et la query TRANSPORTÉS par la frame (sans quoi une
 * mutation par la socket se ferait refuser sur un corps vide).
 *
 * Décor : serveur de dev sur 5152 (skill `nodefony-start-server`), routes
 * `src/modules/test/nodefony/controller/SchemaRouteController.ts`, socket
 * anonyme `/api/live/realtime` (zone `test-live`).
 */
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const PREFIX = "/nodefony/test/schema";
const SOCKET_URL = "wss://127.0.0.1:5152/api/live/realtime";
const TIMEOUT = 10_000;

type Res = { status: number; body: Record<string, unknown> };

/** Garde : un objet JSON (et non un tableau ni une valeur nue). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Les champs fautifs d'un 422, rendus `partie.champ` — lus sans rien supposer. */
function fieldPaths(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((f: unknown) =>
    isRecord(f) ? `${String(f.in)}.${String(f.field)}` : "?",
  );
}

function http(
  method: string,
  path: string,
  payload?: unknown,
  raw?: Buffer,
  rawType = "application/octet-stream",
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      raw ??
      (payload === undefined ? null : Buffer.from(JSON.stringify(payload)));
    const req = https.request(
      {
        ...BASE,
        method,
        path,
        headers: data
          ? {
              "content-type": raw ? rawType : "application/json",
              "content-length": String(data.length),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: Record<string, unknown> = {};
          try {
            const parsed: unknown = text ? JSON.parse(text) : {};
            body = isRecord(parsed) ? parsed : { raw: parsed };
          } catch {
            body = { raw: text };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

/** Réponse JSON-RPC : `result`, ou le `data` de l'erreur (statut, champs). */
type RpcReply = { result: unknown; error: Record<string, unknown> | null };

/** Le `data` d'une erreur JSON-RPC. */
function errorData(reply: RpcReply): Record<string, unknown> {
  const data = reply.error?.data;
  return isRecord(data) ? data : {};
}

type Socket = {
  call: (params: Record<string, unknown>) => Promise<RpcReply>;
  close: () => void;
};

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SOCKET_URL, { rejectUnauthorized: false });
    const pending = new Map<number, (r: RpcReply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("welcome timeout")),
      TIMEOUT,
    );
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (data: Buffer) => {
      const parsed: unknown = JSON.parse(String(data));
      if (!isRecord(parsed)) return;
      const frame = parsed;
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        resolve({
          call: (params) =>
            new Promise<RpcReply>((res, rej) => {
              const id = nextId++;
              const t = setTimeout(
                () => rej(new Error("rpc timeout")),
                TIMEOUT,
              );
              pending.set(id, (reply) => {
                clearTimeout(t);
                res(reply);
              });
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  method: "api.request",
                  params,
                }),
              );
            }),
          close: () => ws.close(),
        });
        return;
      }
      if (typeof frame.id === "number" && frame.method === undefined) {
        pending.get(frame.id)?.({
          result: frame.result,
          error: isRecord(frame.error) ? frame.error : null,
        });
        pending.delete(frame.id);
      }
    });
  });
}

describe("Route à schéma — HTTP (requires server)", () => {
  it("valide puis passe à l'action UNE entrée typée : params et query coercés, défaut appliqué", async () => {
    const res = await http("POST", `${PREFIX}/posts/42`, { title: "Bonjour" });
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      id: 42,
      draft: "0",
      title: "Bonjour",
      hasHeaders: true,
    });
  });

  it("une entrée invalide est un 422 qui nomme chaque champ et sa partie", async () => {
    const res = await http("POST", `${PREFIX}/posts/abc?draft=9`, {
      title: "x",
    });
    expect(res.status).to.equal(422);
    const error = isRecord(res.body.error) ? res.body.error : {};
    expect(fieldPaths(error.fields)).to.deep.equal([
      "params.id",
      "query.draft",
      "body.title",
    ]);
  });

  it("query seule : coercition et défaut", async () => {
    const res = await http("GET", `${PREFIX}/search?q=nodefony`);
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ q: "nodefony", page: 1 });
  });

  it("validateur ASYNCHRONE : la route attend son verdict", async () => {
    expect(
      (await http("POST", `${PREFIX}/slug`, { slug: "libre" })).status,
    ).to.equal(200);
    const taken = await http("POST", `${PREFIX}/slug`, { slug: "pris" });
    expect(taken.status).to.equal(422);
  });

  it("corps BINAIRE : le schéma reçoit les octets tels quels (Uint8Array)", async () => {
    const res = await http(
      "POST",
      `${PREFIX}/bytes`,
      undefined,
      Buffer.from([9, 8, 7]),
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ length: 3, first: 9 });
    // Un corps JSON n'est pas des octets : le même schéma le refuse en 422.
    expect((await http("POST", `${PREFIX}/bytes`, { a: 1 })).status).to.equal(
      422,
    );
  });

  it("corps TEXTE : une chaîne décodée au charset déclaré", async () => {
    const res = await http(
      "POST",
      `${PREFIX}/text`,
      undefined,
      Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      "text/plain; charset=latin1",
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ text: "café" });
  });

  it("bodyStream : l'action lit le flux, le pipeline ne l'a pas consommé", async () => {
    const res = await http(
      "POST",
      `${PREFIX}/upload?name=dump`,
      undefined,
      Buffer.alloc(4096, 7),
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ name: "dump", bytes: 4096 });
  });
});

describe("Route à schéma — pont WebSocket api.request (requires server)", () => {
  it("valide le corps et la query TRANSPORTÉS par la frame", async () => {
    const socket = await connect();
    try {
      const reply = await socket.call({
        path: `${PREFIX}/posts/7?draft=1`,
        method: "POST",
        body: { title: "Par la socket" },
      });
      expect(reply.error, JSON.stringify(reply.error)).to.equal(null);
      expect(reply.result).to.deep.include({
        id: 7,
        draft: "1",
        title: "Par la socket",
      });
      const search = await socket.call({
        path: `${PREFIX}/search?q=ws&page=3`,
      });
      expect(search.result).to.deep.equal({ q: "ws", page: 3 });
    } finally {
      socket.close();
    }
  });

  it("une entrée invalide est le MÊME 422 que sur HTTP, champs compris", async () => {
    const socket = await connect();
    try {
      const reply = await socket.call({
        path: `${PREFIX}/posts/abc`,
        method: "POST",
        body: { title: "x" },
      });
      const data = errorData(reply);
      expect(data.status).to.equal(422);
      expect(fieldPaths(data.fields)).to.deep.equal([
        "params.id",
        "body.title",
      ]);
    } finally {
      socket.close();
    }
  });
});
