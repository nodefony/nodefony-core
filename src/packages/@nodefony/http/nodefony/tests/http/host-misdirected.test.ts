/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

// R3 (vague 5) — Host hors `trustedHosts` → 421 Misdirected Request
// (RFC 9110 §15.5.20 : le serveur n'est pas autoritaire pour cette cible).
// Avant : 401 Unauthorized — sémantiquement faux (401 exige un défi
// d'authentification `WWW-Authenticate`, RFC 9110 §15.5.2).
// Pré-requis serveur dev : `domainCheck: true` + trustedHosts
// ["localhost", "127.0.0.1", "nodefony.com"] (nodefony.config.ts).

function getWithHost(host: string): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 5151,
        path: "/nodefony/test",
        method: "GET",
        headers: { Host: host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            raw: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Host non autorisé → 421 Misdirected Request (RFC 9110 §15.5.20)", () => {
  it("Host: evil.example → 421 (ni 401, ni 500)", async () => {
    const { status } = await getWithHost("evil.example");
    expect(status).to.equal(421);
  });

  it("Host autorisé (localhost) → 200", async () => {
    const { status } = await getWithHost("localhost");
    expect(status).to.equal(200);
  });
});
