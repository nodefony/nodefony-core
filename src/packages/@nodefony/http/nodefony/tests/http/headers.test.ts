/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// Conformité RFC des en-têtes de réponse par défaut.
// RFC 9110 : §8.3 Content-Type, §8.6 Content-Length, §6.6.1 Date.
// RFC 8259 §11 : application/json SANS paramètre charset (JSON = UTF-8 par spec).
// Le serveur écoute en HTTPS/5152 ; sans ALPNProtocols le client négocie HTTP/1.1.

interface HttpResult {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function request(
  path: string,
  method = "GET",
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method,
        rejectUnauthorized: false,
        headers: extraHeaders,
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

describe("HTTP HEADERS — conformité RFC (réponse par défaut)", () => {
  it("page HTML : Content-Type text/html; charset=utf-8 (RFC 9110 §8.3)", async () => {
    const r = await request("/");
    expect(r.status).to.equal(200);
    expect(r.headers["content-type"]).to.equal("text/html; charset=utf-8");
  });

  it("JSON : Content-Type application/json SANS charset (RFC 8259 §11)", async () => {
    const r = await request("/nodefony/test/index4");
    expect(r.status).to.equal(200);
    expect(r.headers["content-type"]).to.equal("application/json");
    expect(r.headers["content-type"]).to.not.contain("charset");
  });

  it("Content-Length présent et exact (RFC 9110 §8.6)", async () => {
    const r = await request("/nodefony/test/index4");
    const cl = r.headers["content-length"];
    expect(cl, "Content-Length manquant").to.exist;
    expect(Number(cl)).to.equal(Buffer.byteLength(r.body));
  });

  it("Date présent (RFC 9110 §6.6.1) et parseable", async () => {
    const r = await request("/");
    const date = r.headers["date"];
    expect(date, "Date manquant").to.exist;
    expect(Number.isNaN(Date.parse(date as string))).to.equal(false);
  });

  it("x-request-id présent par défaut (traçabilité)", async () => {
    const r = await request("/");
    expect(r.headers["x-request-id"], "x-request-id manquant").to.exist;
  });

  it("x-request-id : echo du X-Request-Id client (corrélation)", async () => {
    const id = "test-rfc-req-id-123456";
    const r = await request("/", "GET", { "X-Request-Id": id });
    expect(r.headers["x-request-id"]).to.equal(id);
  });

  it("404 : conserve Content-Type + Date (réponse d'erreur conforme)", async () => {
    const r = await request("/this-route-does-not-exist");
    expect(r.status).to.equal(404);
    expect(r.headers["content-type"], "Content-Type manquant sur 404").to.exist;
    expect(r.headers["date"], "Date manquant sur 404").to.exist;
  });

  it("HEAD : statut 200 sans corps (RFC 9110 §9.3.2)", async () => {
    const r = await request("/", "HEAD");
    expect(r.status).to.equal(200);
    expect(r.body).to.equal("");
  });
});
