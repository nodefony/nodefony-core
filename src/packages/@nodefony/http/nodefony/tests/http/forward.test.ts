/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// `Controller.forward()` = re-dispatch INTERNE vers un autre controller sur le
// MÊME contexte (requête/méthode/corps inchangés). RFC 9110 : ce n'est PAS une
// redirection (3xx) — aucun `Location`, pas de nouveau round-trip, l'URL cliente
// ne change pas. La réponse est celle du controller cible (status par défaut 200).

interface HttpResult {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function request(path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("HTTP FORWARD — conformité RFC (re-dispatch interne, pas un 3xx)", () => {
  it("forward répond 200 (jamais un statut de redirection 3xx)", async () => {
    const r = await request("/nodefony/test/forward");
    expect(r.status).to.equal(200);
    expect(r.status, "forward ne doit pas redirect").to.not.be.within(300, 399);
  });

  it("forward n'émet PAS d'en-tête Location (≠ redirect)", async () => {
    const r = await request("/nodefony/test/forward");
    expect(r.headers["location"], "Location interdit sur un forward").to.not
      .exist;
  });

  it("la réponse provient du controller cible (Content-Type rendu)", async () => {
    const r = await request("/nodefony/test/forward");
    // Le controller cible (RouteController:method1) rend du JSON → Content-Type
    // posé par le pipeline du forward, pas de charset (RFC 8259 §11).
    expect(r.headers["content-type"]).to.contain("application/json");
  });

  it("forward conserve x-request-id (même contexte, traçabilité continue)", async () => {
    const r = await request("/nodefony/test/forward");
    expect(r.headers["x-request-id"], "x-request-id manquant").to.exist;
  });
});
