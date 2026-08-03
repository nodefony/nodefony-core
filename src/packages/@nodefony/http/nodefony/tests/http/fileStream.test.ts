/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

describe("HTTP STREAM", () => {
  it("GET /stream", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/html/stream",
        method: "GET",
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.equal("application/json");
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      req.on("error", (e) => {
        done(e);
      });
      req.end();
    }));

  it("GET /download", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/html/download",
        method: "GET",
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-disposition"]).to.include(
              `attachment; filename="tsconfig.json"`,
            );
            expect(res.headers["content-length"]).to.be.a("string");
            expect(res.headers["content-type"]).to.equal("application/json");
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      req.on("error", (e) => {
        done(e);
      });
      req.end();
    }));

  it("GET /media", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const options = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/html/media",
        method: "GET",
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            expect(res.statusCode).to.equal(200);
            expect(res.headers["content-type"]).to.equal("video/webm");
            done();
          } catch (e) {
            done(e);
          }
        });
      });
      req.on("error", (e) => {
        done(e);
      });
      req.end();
    }));
});

describe("HTTP STREAM  with Range", () => {
  it("GET /media with Range header", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const size = 14625011;
      const start = 0;
      const end = 999;
      const range = `bytes=${start}-${end}`;
      const expectedChunkSize = end - start + 1;

      const options: https.RequestOptions = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/html/media",
        method: "GET",
        rejectUnauthorized: false,
        headers: { Range: range },
      };

      const req = https.request(options, (res) => {
        res.resume();
        res.on("end", () => {
          try {
            expect(res.statusCode).to.equal(206);
            expect(res.headers["content-range"]).to.equal(
              `bytes ${start}-${end}/${size}`,
            );
            expect(res.headers["accept-ranges"]).to.equal("bytes");
            expect(res.headers["content-length"]).to.equal(
              expectedChunkSize.toString(),
            );
            done();
          } catch (e) {
            done(e);
          }
        });
      });

      req.on("error", (e) => done(e));
      req.end();
    }));
});

// R1 (vague 5) — robustesse Range RFC 9110 : un header client ne produit
// JAMAIS un 500. Hors représentation → 416 (§15.5.17) ; invalide → ignoré,
// 200 complet (§14.2) ; suffixe/clamp → 206 corrects (§14.1.2).
describe("HTTP STREAM Range — conformité RFC 9110 (416 / ignore / clamp)", () => {
  const SIZE = 14625011;

  function getMedia(range: string | null): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    bytes: number;
  }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/test/html/media",
        method: "GET",
        rejectUnauthorized: false,
        headers: range ? { Range: range } : {},
      };
      const req = https.request(options, (res) => {
        let bytes = 0;
        res.on("data", (c: Buffer) => (bytes += c.length));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, bytes }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  }

  // RFC 9110 §15.5.5 — le 404 est l'absence de « représentation courante pour la
  // ressource cible » ; le 500 (§15.6.1) suppose une condition INATTENDUE. Un
  // chemin de média qui ne désigne aucun fichier n'a rien d'inattendu : il vient
  // d'une entrée. Ce cas passe par le pipeline COMPLET, seul endroit où se voit
  // ce que le client reçoit vraiment — le test unitaire ne prouve que le code
  // porté par l'erreur.
  it("média ABSENT → 404, et le chemin serveur ne fuit pas", async () => {
    const { status, bytes } = await new Promise<{
      status: number;
      bytes: string;
    }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "localhost",
          port: 5152,
          path: "/nodefony/test/html/media-missing",
          method: "GET",
          rejectUnauthorized: false,
        },
        (res) => {
          let corps = "";
          res.on("data", (c: Buffer) => (corps += c.toString()));
          res.on("end", () =>
            resolve({ status: res.statusCode!, bytes: corps }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).to.equal(404);
    // La même section autorise à ne pas divulguer l'existence d'une ressource :
    // un chemin de système de fichiers dans le corps est une fuite.
    expect(bytes).to.not.include("aucun-media-ici");
  });

  it("Range hors représentation → 416 + Content-Range: bytes */<len>", async () => {
    const { status, headers } = await getMedia("bytes=999999999999-");
    expect(status).to.equal(416);
    expect(headers["content-range"]).to.equal(`bytes */${SIZE}`);
  });

  it("Range malformé (bytes=abc-def) → ignoré : 200 complet (avant : 500)", async () => {
    const { status, headers } = await getMedia("bytes=abc-def");
    expect(status).to.equal(200);
    expect(headers["content-length"]).to.equal(String(SIZE));
  });

  it("Range first>last (bytes=500-100, invalide) → ignoré : 200", async () => {
    const { status } = await getMedia("bytes=500-100");
    expect(status).to.equal(200);
  });

  it("suffixe bytes=-1000 → 206, les 1000 derniers octets", async () => {
    const { status, headers, bytes } = await getMedia("bytes=-1000");
    expect(status).to.equal(206);
    expect(headers["content-range"]).to.equal(
      `bytes ${SIZE - 1000}-${SIZE - 1}/${SIZE}`,
    );
    expect(bytes).to.equal(1000);
  });

  it("end ≥ taille → clampé : 206 avec end = len-1 (Content-Length exact)", async () => {
    const { status, headers } = await getMedia(
      `bytes=${SIZE - 10}-${SIZE * 2}`,
    );
    expect(status).to.equal(206);
    expect(headers["content-range"]).to.equal(
      `bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`,
    );
    expect(headers["content-length"]).to.equal("10");
  });
});
