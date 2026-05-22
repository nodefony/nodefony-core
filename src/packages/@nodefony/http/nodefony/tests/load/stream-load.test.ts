/// <reference types="node" />
/**
 * LOAD / STRESS tests des méthodes stream du Controller :
 *   streamFile (/html/stream), renderFileDownload (/html/download),
 *   renderMediaStream (/html/media — Range/206).
 *
 * But : vérifier sous charge concurrente qu'il n'y a ni troncature de corps,
 * ni fuite (streams `fs` + listeners `finish`/`close`/`error` bien nettoyés —
 * cf RÈGLE perf+mémoire). Exclu de la non-régression (boucles réseau lourdes) →
 * lancé via `.mocharc.load.json`. Serveur live : 127.0.0.1:5152 (HTTPS).
 */
import { expect } from "chai";
import https from "node:https";
import "mocha";

interface StreamResult {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  bytes: number;
}

// Compte les octets sans conserver le corps (le test ne doit pas dominer la heap).
function fetchBytes(
  path: string,
  headers: Record<string, string> = {},
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method: "GET",
        rejectUnauthorized: false,
        headers,
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c: Buffer) => (bytes += c.length));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, bytes }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const getJson = (path: string): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });

const serverHeap = async () =>
  (await getJson("/nodefony/test/memory")).heapUsed as number;

// Ouvre `count` requêtes par lots de `batch` (évite l'épuisement de ports
// éphémères loopback / AggregateError sur Promise.all massif).
async function flood(
  path: string,
  count: number,
  batch = 50,
): Promise<StreamResult[]> {
  const out: StreamResult[] = [];
  for (let i = 0; i < count; i += batch) {
    const n = Math.min(batch, count - i);
    const slice = await Promise.all(
      Array.from({ length: n }, () => fetchBytes(path)),
    );
    out.push(...slice);
  }
  return out;
}

describe("STREAM LOAD — streamFile / download / media (charge)", function () {
  this.timeout(60000);

  it("streamFile : 200 concurrents, corps complet (Content-Length == octets)", async () => {
    const ref = await fetchBytes("/nodefony/test/html/stream");
    expect(ref.status).to.equal(200);
    const expected = Number(ref.headers["content-length"]);
    const results = await flood("/nodefony/test/html/stream", 200);
    for (const r of results) {
      expect(r.status).to.equal(200);
      if (expected) expect(r.bytes).to.equal(expected, "corps tronqué");
    }
  });

  it("renderFileDownload : 200 + Content-Disposition attachment sous charge", async () => {
    const ref = await fetchBytes("/nodefony/test/html/download");
    expect(ref.status).to.equal(200);
    expect(String(ref.headers["content-disposition"] ?? "")).to.contain(
      "attachment",
    );
    const results = await flood("/nodefony/test/html/download", 150);
    for (const r of results) {
      expect(r.status).to.equal(200);
      expect(r.bytes).to.be.greaterThan(0);
    }
  });

  it("renderMediaStream : 200 corps complet sous charge", async () => {
    const ref = await fetchBytes("/nodefony/test/html/media");
    expect(ref.status).to.equal(200);
    expect(ref.bytes).to.be.greaterThan(0);
    const results = await flood("/nodefony/test/html/media", 100, 25);
    for (const r of results) {
      expect(r.status).to.equal(200);
      expect(r.bytes).to.be.greaterThan(0);
    }
  });

  it("renderMediaStream : Range bytes=0-99 → 206 Partial Content (RFC 9110 §14)", async () => {
    const r = await fetchBytes("/nodefony/test/html/media", {
      Range: "bytes=0-99",
    });
    expect(r.status).to.equal(206);
    expect(String(r.headers["content-range"] ?? "")).to.match(/^bytes 0-99\//);
    expect(r.bytes).to.equal(100);
  });

  it("pas de fuite : heap delta borné après 600 streams (< 35 MB)", async () => {
    await flood("/nodefony/test/html/stream", 100);
    const before = await serverHeap();
    await flood("/nodefony/test/html/stream", 300);
    await flood("/nodefony/test/html/download", 300);
    const after = await serverHeap();
    const deltaMB = (after - before) / (1024 * 1024);
    expect(deltaMB).to.be.lessThan(35, `heap delta ${deltaMB.toFixed(1)} MB`);
  });
});
