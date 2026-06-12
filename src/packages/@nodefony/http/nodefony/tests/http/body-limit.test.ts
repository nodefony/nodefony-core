/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

// B1 — limite de taille du corps NON-multipart (maxBodySize, défaut 1 MiB).
// Deux rideaux : pré-check Content-Length (rejet avant lecture) + compteur
// streaming (chunked / Content-Length menteur). Le multipart est exclu (busboy).
// Requiert le serveur dev (port 5151).

const BASE = { hostname: "localhost", port: 5151 };
const MAX = 1_048_576; // défaut schéma (1 MiB)

type Res = { status: number; headers: Record<string, unknown>; body: string };

// Requête avec Content-Length explicite (auto par http.request).
function req(
  method: string,
  path: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { ...BASE, method, path, headers: extraHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

// Requête chunked SANS Content-Length (Transfer-Encoding: chunked auto). Résout
// soit sur la réponse, soit sur une erreur d'écriture (le serveur a coupé le
// flux trop gros) — les DEUX prouvent le refus du corps surdimensionné.
function reqChunked(
  path: string,
  totalBytes: number,
): Promise<{ status: number | null; errored: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { status: number | null; errored: boolean }) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const r = http.request(
      {
        ...BASE,
        method: "POST",
        path,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () =>
          done({ status: res.statusCode ?? null, errored: false }),
        );
      },
    );
    r.on("error", () => done({ status: null, errored: true }));
    const chunk = Buffer.alloc(64 * 1024, 0x61); // 64 KiB de 'a'
    let written = 0;
    const pump = () => {
      while (written < totalBytes) {
        written += chunk.length;
        if (!r.write(chunk)) {
          r.once("drain", pump);
          return;
        }
      }
      r.end();
    };
    pump();
  });
}

describe("BODY LIMIT — maxBodySize (B1, requires server)", () => {
  it("POST sous la limite → 200 (pas de régression)", async () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const { status } = await req("POST", "/nodefony/test/route/add", body, {
      "Content-Type": "application/json",
    });
    expect(status).to.equal(200);
  }, 10000);

  it("POST Content-Length > 1 MiB → 413 (pré-check, avant lecture)", async () => {
    const body = Buffer.alloc(MAX + 4096, 0x61); // 1 MiB + 4 KiB
    const { status } = await req("POST", "/nodefony/test/route/add", body, {
      "Content-Type": "application/json",
    });
    expect(status).to.equal(413);
  }, 10000);

  it("POST chunked > 1 MiB (sans Content-Length) → refusé (compteur streaming)", async () => {
    const { status, errored } = await reqChunked(
      "/nodefony/test/route/add",
      2 * MAX, // 2 MiB en chunks → dépasse en cours de route
    );
    // 413 reçu OU connexion coupée : les deux prouvent que le corps
    // surdimensionné n'est PAS bufferisé intégralement (RAM bornée).
    expect(status === 413 || errored).to.equal(true);
  }, 10000);
});
