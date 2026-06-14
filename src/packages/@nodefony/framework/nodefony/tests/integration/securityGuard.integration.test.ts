/// <reference types="node" />
/**
 * Integration — P6 J7 : autorisation déclarative `@IsGranted` de bout en bout.
 * Preuve « 1 garde, vraie route » sur la zone `test-secure` (Basic auth) :
 *   admin (ROLE_ADMIN) → 200 · user (ROLE_USER) → 403 · anonyme → 401.
 * Le 403 (authentifié mais non autorisé) PROUVE que la garde est distincte de
 * l'authentification (401). Requires: server on 5151/5152.
 */
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "localhost", port: 5151 };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(
  method: string,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { ...BASE, method, path, headers: { ...extraHeaders } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut */
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

const basic = (u: string, p: string): string =>
  "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

const PATH = "/nodefony/test/secure/admin-only"; // @IsGranted("ROLE_ADMIN") + @CurrentUser

describe("P6 J7 — @IsGranted bout-en-bout (zone test-secure)", () => {
  it("admin (ROLE_ADMIN) → 200, @CurrentUser injecte l'identité", async () => {
    const res = await req("GET", PATH, {
      Authorization: basic("admin", "secret"),
    });
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.include({ granted: true, identifier: "admin" });
  });

  it("user (ROLE_USER : authentifié mais SANS le rôle) → 403 (pas 401)", async () => {
    const res = await req("GET", PATH, {
      Authorization: basic("user", "secret"),
    });
    expect(res.status).to.equal(403); // autz refuse APRÈS l'authn réussie
  });

  it("anonyme → 401 + WWW-Authenticate (firewall, AVANT la garde)", async () => {
    const res = await req("GET", PATH);
    expect(res.status).to.equal(401);
    expect(String(res.headers["www-authenticate"])).to.match(/Basic/);
  });
});
