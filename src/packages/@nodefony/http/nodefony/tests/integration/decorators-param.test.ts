/// <reference types="node" />
/**
 * Décorateurs de paramètre étendus — câblage runtime à travers le VRAI pipeline.
 *
 * Complète les tests unit `@nodefony/framework` (résolution pure `buildParamArgs`)
 * en validant que le `Context` réel satisfait `IParamArgContext` : les noms
 * `request.headers` / `getRequestCookies` / `session` / `request` / `response`
 * résolvent bien end-to-end. C'est le gap que l'unit ne peut pas couvrir.
 *
 * Couvre : @Headers, @Cookie, @Req, @Res, @Session (objet + clé).
 * (@UploadedFile / @UploadedFiles : résolution triviale `queryFile[0]`/`queryFile`
 * couverte en unit ; le remplissage de `queryFile` est testé par upload.test.ts.)
 *
 * Live server: 127.0.0.1:5152 (HTTPS / HTTP/2).
 */
import { expect } from "chai";
import https from "node:https";
import "mocha";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const DECO = "/nodefony/test/decorators";
const REST = "/nodefony/test/rest";

function req(
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { ...BASE, method: "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve({
              status: res.statusCode!,
              body: raw ? JSON.parse(raw) : {},
              headers: res.headers as Record<
                string,
                string | string[] | undefined
              >,
            });
          } catch {
            resolve({ status: res.statusCode!, body: { raw }, headers: {} });
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("Param decorators — câblage runtime (Context réel)", () => {
  it("@Headers(name) → valeur du header + @Headers() → objet complet", async () => {
    const r = await req(`${DECO}/headers`, { "User-Agent": "DecoTest/9.9" });
    expect(r.status).to.equal(200);
    expect(r.body.ua).to.equal("DecoTest/9.9");
    expect(r.body.hasUa).to.equal(true);
  });

  it("@Cookie(name) → valeur du cookie + @Cookie() → map", async () => {
    const r = await req(`${DECO}/cookie`, { Cookie: "sid=abc123; theme=dark" });
    expect(r.status).to.equal(200);
    expect(r.body.sid).to.equal("abc123");
    expect(r.body.count).to.equal(2);
  });

  it("@Cookie(name) absent → null", async () => {
    const r = await req(`${DECO}/cookie`);
    expect(r.status).to.equal(200);
    expect(r.body.sid).to.equal(null);
    expect(r.body.count).to.equal(0);
  });

  it("@Req() → la requête est injectée (method + url lisibles)", async () => {
    const r = await req(`${DECO}/req`);
    expect(r.status).to.equal(200);
    expect(r.body.method).to.equal("GET");
    expect(r.body.hasUrl).to.equal(true);
  });

  it("@Res() → la réponse injectée est mutable (header sort sur le wire)", async () => {
    const r = await req(`${DECO}/res`);
    expect(r.status).to.equal(200);
    expect(r.body.injected).to.equal(true);
    expect(r.headers["x-from-res"]).to.equal("ok");
  });

  it("@Session() → objet Session live (id présent)", async () => {
    const r = await req(`${REST}/session/deco`);
    expect(r.status).to.equal(200);
    expect(r.body.hasSession).to.equal(true);
    expect(r.body.id).to.be.a("string").with.length.greaterThan(0);
  });

  it("@Session('foo') → valeur lue depuis la session (set puis read, même cookie)", async () => {
    // 1. set foo=bar → récupère le cookie de session
    const set = await req(`${REST}/session/set/foo/bar`);
    expect(set.status).to.equal(200);
    const setCookie = set.headers["set-cookie"];
    expect(setCookie, "session cookie must be issued").to.exist;
    const cookie = (setCookie as string[])
      .map((c) => c.split(";")[0])
      .join("; ");

    // 2. relit via @Session('foo') avec le même cookie de session
    const get = await req(`${REST}/session/deco-key`, { Cookie: cookie });
    expect(get.status).to.equal(200);
    expect(get.body.foo).to.equal("bar");
  });
});
