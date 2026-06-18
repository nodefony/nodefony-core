import { expect } from "chai";
import http from "node:http";
import HttpResponse from "../../src/context/http/Response.js";
import Cookie from "../../src/cookies/cookie.js";
import type HttpContext from "../../src/context/http/HttpContext.js";

// Mock minimal : un store de headers en mémoire (insensible à la casse, comme
// Node) + un contexte stub avec `log` no-op et `type`. Suffit pour exercer
// toute la logique PURE de HttpResponse sans serveur réel.
function makeResponse(): HttpResponse {
  const headers: Record<string, number | string | string[]> = {};
  const mockServerResponse = {
    headersSent: false,
    setHeader: (name: string, value: number | string | string[]) => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    getHeaders: () => ({ ...headers }),
    removeHeader: (name: string) => {
      delete headers[name.toLowerCase()];
    },
    addTrailers: () => {},
  } as unknown as http.ServerResponse;
  const ctx = {
    type: "http",
    log: () => undefined,
  } as unknown as HttpContext;
  return new HttpResponse(mockServerResponse, ctx);
}

describe("HttpResponse — unit tests", () => {
  describe("setStatusCode() — ASCII sanitization (regression ERR_INVALID_CHAR)", () => {
    it("strips em dash (U+2014) from statusMessage", () => {
      const r = makeResponse();
      r.setStatusCode(500, "native error — no HttpError");
      expect(r.statusMessage).to.not.include("—");
      expect(r.statusMessage).to.match(/^[\x20-\x7E]*$/);
    });

    it("strips any non-ASCII char", () => {
      const r = makeResponse();
      r.setStatusCode(400, "mauvais requête");
      expect(r.statusMessage).to.match(/^[\x20-\x7E]*$/);
    });

    it("falls back to standard HTTP text when message is empty after strip", () => {
      const r = makeResponse();
      r.setStatusCode(500, "—–…");
      expect(r.statusMessage).to.equal("Internal Server Error");
    });

    it("leaves plain ASCII message unchanged", () => {
      const r = makeResponse();
      r.setStatusCode(403, "Access Denied");
      expect(r.statusMessage).to.equal("Access Denied");
    });

    it("without message uses standard HTTP status text", () => {
      const r = makeResponse();
      r.setStatusCode(404);
      expect(r.statusMessage).to.equal("Not Found");
    });

    it("coerce une chaîne numérique en code (et NaN → 500)", () => {
      const r = makeResponse();
      expect(r.setStatusCode("418").code).to.equal(418);
      expect(r.setStatusCode("abc").code).to.equal(500);
    });
  });

  describe("setContentType() — politique charset RFC 8259", () => {
    it("application/json : AUCUN paramètre charset (JSON est UTF-8 par spec)", () => {
      const r = makeResponse();
      r.setContentType("application/json", "utf-8");
      expect(r.getHeader("Content-Type")).to.equal("application/json");
      expect(r.contentType).to.equal("application/json");
    });

    it("text/html : charset explicite ajouté", () => {
      const r = makeResponse();
      r.setContentType("text/html", "utf-8");
      expect(r.getHeader("Content-Type")).to.equal("text/html; charset=utf-8");
    });

    it("sans type → reprend contentType courant + charset", () => {
      const r = makeResponse();
      r.setContentType();
      expect(String(r.getHeader("Content-Type"))).to.match(/charset=/);
    });
  });

  describe("setBody() — coercition vers Buffer", () => {
    it("string → Buffer du texte", () => {
      const r = makeResponse();
      const b = r.setBody("hello");
      expect(Buffer.isBuffer(b)).to.equal(true);
      expect(b.toString()).to.equal("hello");
    });

    it("objet → Buffer JSON", () => {
      const r = makeResponse();
      const b = r.setBody({ a: 1 });
      expect(b.toString()).to.equal('{"a":1}');
    });

    it("Buffer (ArrayBufferView) → copie", () => {
      const r = makeResponse();
      const b = r.setBody(Buffer.from("buf"));
      expect(b.toString()).to.equal("buf");
    });

    it("ArrayBuffer → Buffer", () => {
      const r = makeResponse();
      const ab = new Uint8Array([65, 66, 67]).buffer; // "ABC"
      const b = r.setBody(ab);
      expect(b.length).to.equal(3);
    });
  });

  describe("setLength() — Content-Length", () => {
    it("corps non vide → byteLength + header posé", () => {
      const r = makeResponse();
      expect(r.setLength("hello")).to.equal(5);
      expect(r.getHeader("Content-Length")).to.equal("5");
    });

    it("status 204 (No Content) → aucune longueur, retourne 0", () => {
      const r = makeResponse();
      r.setStatusCode(204);
      expect(r.setLength("hello")).to.equal(0);
      expect(r.getHeader("Content-Length")).to.equal(undefined);
    });
  });

  describe("getStatusMessage()", () => {
    it("résout le texte standard depuis un code", () => {
      const r = makeResponse();
      expect(r.getStatusMessage(404)).to.equal("Not Found");
    });

    it("retourne le message déjà posé", () => {
      const r = makeResponse();
      r.setStatusCode(403, "Denied");
      expect(r.getStatusMessage()).to.equal("Denied");
    });
  });

  describe("redirect()", () => {
    it("défaut → 302 (Found) + Location + isRedirect", () => {
      const r = makeResponse();
      r.redirect("/login");
      expect(r.getStatusCode()).to.equal(302);
      expect(r.getHeader("Location")).to.equal("/login");
      expect(
        (r.context as unknown as { isRedirect: boolean }).isRedirect,
      ).to.equal(true);
    });

    it("302 explicite (number)", () => {
      const r = makeResponse();
      r.redirect("/x", 302);
      expect(r.getStatusCode()).to.equal(302);
    });

    it("302 en chaîne → coercé en number", () => {
      const r = makeResponse();
      r.redirect("/x", "302");
      expect(r.getStatusCode()).to.equal(302);
    });

    // RFC 9110 §15.4 — tous les codes de redirection valides sont conservés
    // (avant : tout sauf 302 était écrasé en 301).
    for (const code of [301, 303, 307, 308]) {
      it(`${code} explicite conservé (RFC 9110 §15.4)`, () => {
        const r = makeResponse();
        r.redirect("/x", code);
        expect(r.getStatusCode()).to.equal(code);
      });
    }

    it("308 en chaîne → coercé + conservé (préserve la méthode)", () => {
      const r = makeResponse();
      r.redirect("/x", "308");
      expect(r.getStatusCode()).to.equal(308);
    });

    it("code hors whitelist (200) → fallback 302", () => {
      const r = makeResponse();
      r.redirect("/x", 200);
      expect(r.getStatusCode()).to.equal(302);
    });

    it("code non numérique → fallback 302", () => {
      const r = makeResponse();
      r.redirect("/x", "abc");
      expect(r.getStatusCode()).to.equal(302);
    });

    it("retourne this (chaînable)", () => {
      const r = makeResponse();
      expect(r.redirect("/x")).to.equal(r);
    });
  });

  describe("isHtml() / setters", () => {
    it("isHtml true après Content-Type text/html", () => {
      const r = makeResponse();
      r.setContentType("text/html", "utf-8");
      expect(r.isHtml()).to.equal(true);
    });

    it("isHtml false pour application/json", () => {
      const r = makeResponse();
      r.setContentType("application/json", "utf-8");
      expect(r.isHtml()).to.equal(false);
    });

    it("setEncoding / setTimeout posent les champs", () => {
      const r = makeResponse();
      r.setEncoding("latin1");
      r.setTimeout(5000);
      expect(r.encoding).to.equal("latin1");
      expect(r.timeout).to.equal(5000);
    });
  });

  // Régression CRITIQUE : `setHeader('Set-Cookie', str)` REMPLACE chez Node — une
  // boucle de setHeader perdait tous les cookies sauf le dernier (ex. session +
  // csrf-token). `setCookies()` doit émettre un TABLEAU = N lignes Set-Cookie.
  describe("setCookies() — cookies multiples (régression clobber)", () => {
    it("1 cookie → une string Set-Cookie", () => {
      const r = makeResponse();
      r.addCookie(new Cookie("sid", "abc", { path: "/" }));
      r.setCookies();
      const sc = (r as any).response.getHeader("set-cookie");
      expect(sc).to.be.a("string");
      expect(sc).to.contain("sid=abc");
    });

    it("2 cookies (session + csrf-token) → tableau de 2, AUCUN écrasé", () => {
      const r = makeResponse();
      r.addCookie(new Cookie("nodefony-session", "S1", { path: "/" }));
      r.addCookie(
        new Cookie("csrf-token", "T2", { path: "/", sameSite: "Strict" }),
      );
      r.setCookies();
      const sc = (r as any).response.getHeader("set-cookie") as string[];
      expect(sc).to.be.an("array").with.lengthOf(2);
      const joined = sc.join("\n");
      expect(joined).to.contain("nodefony-session=S1");
      expect(joined).to.contain("csrf-token=T2");
    });

    it("0 cookie → aucun Set-Cookie posé", () => {
      const r = makeResponse();
      r.setCookies();
      expect((r as any).response.getHeader("set-cookie")).to.equal(undefined);
    });
  });
});
