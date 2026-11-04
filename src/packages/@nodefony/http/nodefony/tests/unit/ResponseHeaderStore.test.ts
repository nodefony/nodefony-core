/// <reference types="node" />
/**
 * #727 — la réserve d'en-têtes de `HttpResponse` : tout ce qui est posé part en
 * UN `writeHead(statut, liste plate)`, sans un seul `setHeader` natif avant.
 *
 * Éprouvé sur une VRAIE `http.ServerResponse` : le bloc d'en-têtes lu est celui
 * que Node compose pour le fil (`_header`), pas l'état d'une doublure.
 */
import { expect } from "vitest";
import http from "node:http";
import HttpResponse from "../../src/context/http/Response.js";
import Cookie from "../../src/cookies/cookie.js";
import { mergeResponseHeaders } from "../../src/context/http2/Response.js";
import type HttpContext from "../../src/context/http/HttpContext.js";
import type { IFirewallGate } from "../../interfaces/ISecurity.js";

const TRANSPORT = [
  "server",
  "nodefony",
  "x-content-type-options",
  "nosniff",
  "x-frame-options",
  "SAMEORIGIN",
];

/** Réponse Node réelle, qui compte les `setHeader` natifs. */
class CountingResponse extends http.ServerResponse {
  nativeSets = 0;
  override setHeader(
    name: string,
    value: number | string | readonly string[],
  ): this {
    this.nativeSets++;
    return super.setHeader(name, value);
  }
}

function make(method = "GET") {
  const req = {
    method,
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    headers: {},
  } as unknown as http.IncomingMessage;
  const res = new CountingResponse(req);
  const ctx = {
    method,
    serverType: "http",
    requestId: "req-1",
    traceparent: null,
    httpKernel: { transportHeaders: () => TRANSPORT },
    log: () => undefined,
  } as unknown as HttpContext;
  const r = new HttpResponse(res, ctx);
  return { r, res };
}

/** Lignes d'en-tête que Node a composées pour le fil, sans ligne de statut. */
function wire(res: http.ServerResponse): string[] {
  const raw = String(Reflect.get(res, "_header") ?? "");
  return raw
    .split("\r\n")
    .slice(1)
    .filter((l) => l !== "" && !/^(date|connection|keep-alive):/i.test(l));
}

describe("HttpResponse — réserve d'en-têtes (#727)", () => {
  it("aucun setHeader natif : tout part en UN writeHead à liste plate", () => {
    const { r, res } = make();
    r.setHeader("Content-Security-Policy", "default-src 'self'");
    r.setHeader("Referrer-Policy", "no-referrer");
    r.setContentType("application/json", "utf-8");
    r.setBody('{"a":1}');
    let lists = 0;
    const native = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<typeof native>) => {
      if (Array.isArray(args.at(-1))) lists++;
      return native(...args);
    }) as typeof res.writeHead;
    r.writeHead(200);
    expect(res.nativeSets).to.equal(0);
    expect(lists).to.equal(1);
    expect(wire(res)).to.deep.equal([
      "server: nodefony",
      "x-content-type-options: nosniff",
      "x-frame-options: SAMEORIGIN",
      "content-security-policy: default-src 'self'",
      "referrer-policy: no-referrer",
      "content-type: application/json",
      "x-request-id: req-1",
      "content-length: 7",
    ]);
  });

  it("le transport ouvre la liste, une surcharge le remplace en place, un retrait l'ôte", () => {
    const { r, res } = make();
    r.setHeader("X-Frame-Options", "DENY");
    r.removeHeader("Server");
    r.setBody("");
    r.writeHead(204);
    expect(wire(res)).to.deep.equal([
      "x-content-type-options: nosniff",
      "x-frame-options: DENY",
      "x-request-id: req-1",
    ]);
  });

  it("une valeur invalide lève À L'ÉCRITURE et n'entre jamais : la réponse part quand même", () => {
    const { r, res } = make();
    expect(() => r.setHeader("Location", "/a\r\nSet-Cookie: x=1")).to.throw(
      /Invalid character/,
    );
    expect(() => r.setHeader("Bad Name", "v")).to.throw(/HTTP token/);
    expect(r.getHeader("location")).to.equal(undefined);
    r.setBody("ok");
    r.writeHead(500);
    expect(wire(res).join("\n")).to.not.include("set-cookie");
    expect(res.headersSent).to.equal(true);
  });

  it("une liste invalide lève aussi (chaque élément est contrôlé)", () => {
    const { r } = make();
    expect(() => r.setHeader("Set-Cookie", ["a=1", "b=2\n"])).to.throw(
      /Invalid character/,
    );
  });

  it("Set-Cookie multiples : une ligne par cookie", () => {
    const { r, res } = make();
    r.addCookie(new Cookie("a", "1", { path: "/" }));
    r.addCookie(new Cookie("b", "2", { path: "/" }));
    r.setCookies();
    r.setBody("");
    r.writeHead(200);
    const cookies = wire(res).filter((l) => l.startsWith("set-cookie: "));
    expect(cookies).to.have.length(2);
  });

  it("en-têtes passés à writeHead : ils l'emportent, sans doublon", () => {
    const { r, res } = make();
    r.setHeader("Content-Type", "text/plain");
    r.setBody("x");
    r.writeHead(200, { "Content-Type": "text/html", "X-Extra": "1" });
    const lines = wire(res);
    expect(lines.filter((l) => l.startsWith("content-type:"))).to.deep.equal([
      "content-type: text/html",
    ]);
    expect(lines).to.include("x-extra: 1");
  });

  it("getHeader lit la réserve, puis ce qu'un tiers a écrit sur la réponse Node", () => {
    const { r, res } = make();
    res.setHeader("ETag", '"v1"'); // `send`, quota : écriture native
    r.setHeader("Cache-Control", "no-store");
    expect(r.getHeader("cache-control")).to.equal("no-store");
    expect(r.getHeader("ETag")).to.equal('"v1"');
    expect(r.hasHeader("etag")).to.equal(true);
    expect(r.getHeaders()).to.include({
      etag: '"v1"',
      "cache-control": "no-store",
      server: "nodefony",
    });
  });

  it("commitHeaders recopie la réserve ; la suite fusionne au writeHead, sans doublon", () => {
    const { r, res } = make();
    r.setHeader("Content-Security-Policy", "default-src 'self'");
    r.commitHeaders();
    expect(res.getHeader("content-security-policy")).to.equal(
      "default-src 'self'",
    );
    expect(res.getHeader("server")).to.equal("nodefony");
    // Après la copie : un 404 qui suit (raté du statique).
    r.setContentType("text/html", "utf-8");
    r.setBody("<p>404</p>");
    r.writeHead(404);
    const lines = wire(res);
    expect(lines.filter((l) => /^server:/i.test(l))).to.have.length(1);
    expect(lines.filter((l) => /^content-type:/i.test(l))).to.deep.equal([
      "content-type: text/html; charset=utf-8",
    ]);
    expect(lines.join("\n")).to.include("default-src 'self'");
  });

  it("statique servi : la réserve est recopiée à la PREMIÈRE écriture du tiers, avant elle", () => {
    const { r, res } = make();
    r.setHeader("Content-Security-Policy", "default-src 'self'");
    r.commitBeforeNativeWrite();
    expect(res.nativeSets).to.equal(0);
    // `send` : ses en-têtes, puis le flux.
    res.setHeader("ETag", '"v1"');
    res.setHeader("Content-Type", "image/x-icon");
    expect(Object.hasOwn(res, "setHeader")).to.equal(false);
    res.end("x");
    const lines = wire(res);
    expect(lines.slice(0, 4)).to.deep.equal([
      "server: nodefony",
      "x-content-type-options: nosniff",
      "x-frame-options: SAMEORIGIN",
      "content-security-policy: default-src 'self'",
    ]);
    expect(lines).to.include('ETag: "v1"');
  });

  it("raté du statique : rien n'est recopié, la 404 part en un seul writeHead", () => {
    const { r, res } = make();
    r.commitBeforeNativeWrite();
    r.disarmNativeWrite();
    expect(Object.hasOwn(res, "setHeader")).to.equal(false);
    r.setBody("absent");
    r.writeHead(404);
    expect(res.nativeSets).to.equal(0);
    expect(wire(res)[0]).to.equal("server: nodefony");
  });

  it("setValidatedHeader range sans revalider — Node valide au writeHead", () => {
    const { r, res } = make();
    r.setValidatedHeader("Permissions-Policy", "camera=()");
    expect(r.getHeader("permissions-policy")).to.equal("camera=()");
    r.setBody("");
    r.writeHead(200);
    expect(wire(res)).to.include("permissions-policy: camera=()");
  });

  it("le même bloc qu'avec setHeader natif, à la casse des noms près", () => {
    // Référence : la forme d'avant (setHeader natif par en-tête, puis writeHead).
    const req = {
      method: "GET",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      headers: {},
    } as unknown as http.IncomingMessage;
    const ref = new http.ServerResponse(req);
    for (let i = 0; i < TRANSPORT.length; i += 2) {
      const name = TRANSPORT[i];
      const value = TRANSPORT[i + 1];
      if (name !== undefined && value !== undefined) ref.setHeader(name, value);
    }
    ref.setHeader("vary", "Origin, Accept-Encoding");
    ref.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
    ref.setHeader("content-type", "text/html; charset=utf-8");
    ref.setHeader("x-request-id", "req-1");
    ref.setHeader("content-length", "2");
    ref.writeHead(200);

    const { r, res } = make();
    r.setHeader("Vary", "Origin");
    r.setHeader("Vary", "Accept-Encoding");
    r.setHeader("Set-Cookie", ["a=1; Path=/", "b=2; Path=/"]);
    r.setContentType("text/html", "utf-8");
    r.setBody("ok");
    r.writeHead(200);
    const norm = (lines: string[]) =>
      lines.map((l) => l.replace(/^[^:]+/, (n) => n.toLowerCase())).sort();
    expect(norm(wire(res))).to.deep.equal(norm(wire(ref)));
  });
});

describe("HttpResponse — politique d'en-têtes armée, choisie au writeHead (ADR-0024 §C11)", () => {
  let servedAsFile: boolean[] = [];
  /** Pare-feu doublure : note chaque appel et pose une CSP par défaut. */
  function arm(r: HttpResponse) {
    const calls: Array<string | null | undefined> = [];
    // Par appel : la réponse annonce-t-elle un corps servi tel quel ?
    servedAsFile = [];
    const gate: Pick<IFirewallGate, "applySecurityHeaders"> = {
      applySecurityHeaders: (_ctx, contentType, asFile) => {
        calls.push(contentType);
        servedAsFile.push(asFile === true);
        r.setDefaultHeader("Content-Security-Policy", "fw");
      },
    };
    // Doublure : seul `applySecurityHeaders` est appelé par la réponse.
    r.headerPolicy = gate as IFirewallGate;
    return calls;
  }
  /** Réponse dont la requête vise `pathname` (repli statique). */
  function makeAt(pathname: string) {
    const made = make();
    Reflect.set(made.r.context, "request", { pathname });
    return made;
  }

  it("appelée UNE fois au writeHead, avec le type fixé ; ce qu'elle pose part sur le fil", () => {
    const { r, res } = make();
    const calls = arm(r);
    r.setHeader("Content-Type", "application/json; charset=utf-8");
    r.setBody("{}");
    expect(calls).to.deep.equal([]);
    r.writeHead(200);
    expect(calls).to.deep.equal(["application/json; charset=utf-8"]);
    // Corps écrit par le pipeline : il peut porter le nonce.
    expect(servedAsFile).to.deep.equal([false]);
    expect(r.headerPolicy).to.equal(null);
    expect(wire(res)).to.include("content-security-policy: fw");
  });

  it("type par défaut (filet du writeHead) : la politique le voit", () => {
    const { r } = make();
    const calls = arm(r);
    r.setBody("x");
    r.writeHead(200);
    expect(calls).to.deep.equal(["application/octet-stream"]);
  });

  it("réponse sans contenu (204) : type null", () => {
    const { r } = make();
    const calls = arm(r);
    r.writeHead(204);
    expect(calls).to.deep.equal([null]);
  });

  it("204 typé HTML (render) : sans contenu malgré le type — politique courte", () => {
    const { r } = make();
    const calls = arm(r);
    r.setHeader("Content-Type", "text/html; charset=utf-8");
    r.setBody("");
    r.writeHead(204);
    expect(calls).to.deep.equal([null]);
  });

  it("304 : aucune politique — ses en-têtes remplaceraient ceux de la page en cache", () => {
    const { r, res } = make();
    const calls = arm(r);
    r.writeHead(304);
    expect(calls).to.deep.equal([]);
    expect(wire(res).join("\n")).not.to.match(/content-security-policy/i);
  });

  it("setDefaultHeader : la valeur écrite par l'application gagne", () => {
    const { r, res } = make();
    arm(r);
    r.setHeader("Content-Security-Policy", "app");
    r.setBody("<p>");
    r.writeHead(200);
    const lines = wire(res);
    expect(lines).to.include("content-security-policy: app");
    expect(lines).not.to.include("content-security-policy: fw");
  });

  it("statique servi : le type se lit à l'extension, avant la recopie", () => {
    const { r, res } = makeAt("/assets/app.js");
    const calls = arm(r);
    r.commitBeforeNativeWrite();
    res.setHeader("Content-Type", "text/javascript");
    res.end("x");
    expect(calls).to.deep.equal(["text/javascript"]);
    // Corps écrit par le serveur statique : aucun nonce n'y figure (ADR-0024 §C1).
    expect(servedAsFile).to.deep.equal([true]);
    expect(wire(res)).to.include("content-security-policy: fw");
  });

  it("statique en 304 : la politique de son 200, posée avant que le statique sache la copie fraîche", () => {
    // Le serveur statique écrit ses validateurs (ETag…) AVANT de décider le
    // 304 : la recopie a déjà eu lieu, statut encore 200. Sans effet sur la
    // page gardée — même politique que son 200, et un fichier n'a pas de nonce.
    const { r, res } = makeAt("/assets/app.js");
    const calls = arm(r);
    r.commitBeforeNativeWrite();
    res.setHeader("ETag", '"v1"');
    res.statusCode = 304;
    res.end();
    expect(calls).to.deep.equal(["text/javascript"]);
    expect(String(Reflect.get(res, "_header"))).to.match(/^HTTP\/1\.1 304 /);
    expect(wire(res)).to.include("content-security-policy: fw");
  });

  it("statique visant un dossier (`/` final) : type inconnu, même si son nom a une extension", () => {
    // `mime.lookup("/dir.js/")` rend `text/javascript`, mais le statique sert
    // `dir.js/index.html` : la politique « JavaScript » n'y aurait ni COOP ni
    // Permissions-Policy.
    const { r, res } = makeAt("/dir.js/");
    const calls = arm(r);
    r.commitBeforeNativeWrite();
    res.setHeader("Content-Type", "text/html");
    res.end("x");
    expect(calls).to.deep.equal([undefined]);
  });

  it("statique sans extension connue (index d'un dossier) : type inconnu", () => {
    const { r, res } = makeAt("/docs/");
    const calls = arm(r);
    r.commitBeforeNativeWrite();
    res.setHeader("Content-Type", "text/html");
    res.end("x");
    expect(calls).to.deep.equal([undefined]);
  });

  it("non armée (sans module de sécurité) : rien de plus sur le fil", () => {
    const { r, res } = make();
    r.setBody("{}");
    r.writeHead(200);
    expect(wire(res).join("\n")).not.to.match(/content-security-policy/i);
  });
});

describe("mergeResponseHeaders — la réserve entre la réponse Node et writeHead", () => {
  it("réponse Node < réserve < writeHead", () => {
    const native = {
      getHeaderNames: () => ["etag", "x-a"],
      getHeader: (n: string) => (n === "etag" ? '"v1"' : "native"),
    };
    const merged = mergeResponseHeaders("OK", native, { "X-B": "extra" }, [
      "x-a",
      "stored",
      "x-b",
      "stored",
      "server",
      "nodefony",
    ]);
    expect(merged).to.include({
      etag: '"v1"',
      "x-a": "stored",
      "x-b": "extra",
      server: "nodefony",
    });
  });
});
