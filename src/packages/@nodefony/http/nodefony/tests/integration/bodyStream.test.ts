/// <reference types="node" />
/**
 * P2.9 — `@Body({ stream:true })` end-to-end : le pipeline saute le parse et
 * injecte le flux brut (Readable) ; le controller le pipe lui-même (gros upload
 * sans pic RAM). Vérifie aussi la non-régression de `@Body()` classique (parsé).
 *
 * Live server : route POST /nodefony/test/decorators/body-stream (renvoie
 * `{ isReadable, bytes, parsedKeys }`). Couvre HTTP/1 clair (5151) + TLS (5152).
 */
import { expect } from "chai";
import http from "node:http";
import https from "node:https";

type Resp = { status: number; json: Record<string, unknown> };

function post(
  secure: boolean,
  path: string,
  payload: Buffer,
  contentType = "application/octet-stream",
): Promise<Resp> {
  const mod = secure ? https : http;
  const port = secure ? 5152 : 5151;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": contentType,
          "content-length": payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode!,
              json: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const STREAM = "/nodefony/test/decorators/body-stream";
const BODY = "/nodefony/test/decorators/body";

describe("P2.9 — @Body({ stream }) end-to-end", () => {
  it("flux brut (Readable) injecté, octets exacts, parse SAUTÉ (TLS)", async () => {
    const payload = Buffer.from("hello stream");
    const r = await post(true, STREAM, payload);
    expect(r.status).to.equal(200);
    expect(r.json.isReadable, "le param doit être un Readable").to.equal(true);
    expect(r.json.bytes).to.equal(payload.length);
    expect(r.json.parsedKeys, "le body ne doit PAS être parsé").to.equal(0);
  });

  it("gros body 1 Mo streamé sans troncature ni pic (TLS)", async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x61);
    const r = await post(true, STREAM, payload);
    expect(r.status).to.equal(200);
    expect(r.json.isReadable).to.equal(true);
    expect(r.json.bytes).to.equal(1024 * 1024);
    expect(r.json.parsedKeys).to.equal(0);
  });

  it("fonctionne aussi en HTTP/1 clair (5151)", async () => {
    const payload = Buffer.from("clear-http-stream-123");
    const r = await post(false, STREAM, payload);
    expect(r.status).to.equal(200);
    expect(r.json.isReadable).to.equal(true);
    expect(r.json.bytes).to.equal(payload.length);
    expect(r.json.parsedKeys).to.equal(0);
  });

  it("body vide en stream → Readable, 0 octet (pas de hang)", async () => {
    const r = await post(true, STREAM, Buffer.alloc(0));
    expect(r.status).to.equal(200);
    expect(r.json.isReadable).to.equal(true);
    expect(r.json.bytes).to.equal(0);
  });

  it("non-régression : @Body() classique reste parsé (JSON)", async () => {
    const r = await post(
      true,
      BODY,
      Buffer.from(JSON.stringify({ a: 1, b: 2 })),
      "application/json",
    );
    expect(r.status).to.equal(200);
    expect(r.json).to.deep.equal({ a: 1, b: 2 });
  });
});
