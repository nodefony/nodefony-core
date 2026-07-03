/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import https from "node:https";

// Probes de santé cloud-native /livez + /readyz (Phase 0.7).
// Court-circuit TOTAL du pipeline : pas de session (0 Set-Cookie), pas de
// contexte, réponses minimales. Servies par HTTP (5151) ET HTTPS (5152).
// La bascule readiness→503 au SIGTERM est prouvée par le banc e2e
// `run.sh graceful` (elle arrête le serveur — pas testable ici).

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, secure = false): Promise<Res> {
  return new Promise((resolve, reject) => {
    const mod = secure ? https : http;
    const r = mod.request(
      {
        hostname: "localhost",
        port: secure ? 5152 : 5151,
        method: "GET",
        path,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            // raw non-JSON : gardé tel quel
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("Health probes /livez + /readyz (cloud-native 0.7)", () => {
  it("GET /livez → 200 {status:ok} JSON no-store", async () => {
    const res = await get("/livez");
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: "ok" });
    expect(res.headers["content-type"]).to.equal("application/json");
    expect(res.headers["cache-control"]).to.equal("no-store");
  });

  it("GET /readyz → 200 {status:ok} (serveur booté)", async () => {
    const res = await get("/readyz");
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: "ok" });
  });

  it("probes servies aussi en HTTPS (kubelet scheme: HTTPS)", async () => {
    const livez = await get("/livez", true);
    const readyz = await get("/readyz", true);
    expect(livez.status).to.equal(200);
    expect(readyz.status).to.equal(200);
  });

  it("ne crée JAMAIS de session (0 Set-Cookie — sondées toutes les 2-10 s)", async () => {
    const res = await get("/livez");
    expect(res.headers["set-cookie"]).to.equal(undefined);
    const res2 = await get("/readyz");
    expect(res2.headers["set-cookie"]).to.equal(undefined);
  });

  it("match STRICT du path : /livez?x=1 tombe dans le pipeline normal (404)", async () => {
    const res = await get("/livez?x=1");
    expect(res.status).to.equal(404);
  });
});
