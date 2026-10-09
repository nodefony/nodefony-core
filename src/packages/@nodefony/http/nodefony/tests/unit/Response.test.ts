import { expect } from "vitest";
import http from "node:http";
import mime from "mime-types";
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

  // #508 — la résolution MIME est mémorisée. L'oracle est l'algorithme
  // d'AVANT, recopié tel quel : chaque appel (à froid, puis servi par le cache)
  // doit rendre le même en-tête et les mêmes champs.
  describe("setContentType() — mémorisation de la résolution MIME (#508)", () => {
    function oracle(type: string, encoding?: BufferEncoding) {
      if (encoding) {
        const full = mime.contentType(type);
        if (!full) return null;
        const mytype = full.split(";")[0] ?? full;
        const header =
          mytype === "application/json" || mytype.endsWith("+json")
            ? mytype
            : `${mytype}; charset=${encoding}`;
        return { header, contentType: mytype, encoding };
      }
      const mytype = mime.contentType(type);
      if (!mytype) return null;
      const charset = mime.charset(mytype);
      return {
        header: mytype,
        contentType: mytype,
        encoding: charset || undefined,
      };
    }
    const types = [
      "json",
      "html",
      "txt",
      "css",
      "js",
      "svg",
      "png",
      "application/json",
      "application/ld+json",
      "application/problem+json",
      "text/html",
      "text/plain; charset=latin1",
      "text/event-stream",
      "application/octet-stream",
    ];
    for (const encoding of ["utf-8", undefined] as const) {
      for (const type of types) {
        it(`${type} (${encoding ?? "sans encodage"}) — identique à froid et depuis le cache`, () => {
          const want = oracle(type, encoding);
          expect(want, "type connu de mime-types").to.not.equal(null);
          for (let pass = 0; pass < 2; pass++) {
            const r = makeResponse();
            r.setContentType(type, encoding);
            expect(r.getHeader("Content-Type")).to.equal(want?.header);
            expect(r.contentType).to.equal(want?.contentType);
            if (want?.encoding) expect(r.encoding).to.equal(want.encoding);
          }
        });
      }
    }

    it("un type inconnu n'est PAS mémorisé : enregistré ensuite, il se résout", () => {
      const ext = "nfb1unknown";
      const r = makeResponse();
      r.setContentType(ext, "utf-8");
      // repli : contentType courant (text/plain par défaut), pas le type demandé
      expect(String(r.getHeader("Content-Type"))).to.not.include("x-nfb1");
      mime.types[ext] = "application/x-nfb1";
      try {
        const r2 = makeResponse();
        r2.setContentType(ext, "utf-8");
        expect(r2.getHeader("Content-Type")).to.equal(
          "application/x-nfb1; charset=utf-8",
        );
      } finally {
        delete mime.types[ext];
      }
    });

    it("au-delà de la borne, la résolution reste juste (sans mémoriser)", () => {
      const exts = Object.keys(mime.types).slice(0, 200);
      for (const ext of exts) {
        const r = makeResponse();
        r.setContentType(ext, "utf-8");
        expect(r.getHeader("Content-Type"), ext).to.equal(
          oracle(ext, "utf-8")?.header,
        );
      }
    });
  });

  describe("setBody() — body rend toujours des octets", () => {
    it("string → octets du texte", () => {
      const r = makeResponse();
      r.setBody("hello");
      expect(Buffer.isBuffer(r.body)).to.equal(true);
      expect(r.body!.toString()).to.equal("hello");
    });

    it("objet → octets JSON", () => {
      const r = makeResponse();
      r.setBody({ a: 1 });
      expect(r.body!.toString()).to.equal('{"a":1}');
    });

    it("Buffer (ArrayBufferView) → copie", () => {
      const r = makeResponse();
      r.setBody(Buffer.from("buf"));
      expect(r.body!.toString()).to.equal("buf");
    });

    it("ArrayBuffer → Buffer", () => {
      const r = makeResponse();
      const ab = new Uint8Array([65, 66, 67]).buffer; // "ABC"
      r.setBody(ab);
      expect(r.body!.length).to.equal(3);
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

/**
 * F12 — `Vary` est une LISTE (RFC 9110 §12.5.5), pas une valeur unique.
 *
 * Le firewall pose `Vary: Origin` dès que la réponse reflète l'origine du
 * demandeur. Si un controller écrit ensuite son propre `Vary`, l'écrasement fait
 * disparaître `Origin` : un cache partagé cesse alors de distinguer les origines
 * et peut servir à B une réponse portant `Access-Control-Allow-Origin: A`.
 * La fusion ferme le trou quel que soit l'ordre d'écriture — on ne dépend plus de
 * la discipline de chaque appelant.
 */
describe("HttpResponse — Vary ne s'écrase pas (F12)", () => {
  const varyOf = (r: HttpResponse): string =>
    String(
      (
        r as unknown as { response: { getHeader(n: string): unknown } }
      ).response.getHeader("vary"),
    );

  it("un second Vary s'AJOUTE au premier au lieu de le remplacer", () => {
    const r = makeResponse();
    r.setHeader("Vary", "Origin"); // firewall (reflet d'origine)
    r.setHeader("Vary", "Accept-Encoding"); // controller applicatif
    expect(varyOf(r)).to.equal("Origin, Accept-Encoding");
  });

  it("l'ordre inverse donne le même ensemble — Origin survit dans les deux cas", () => {
    const r = makeResponse();
    r.setHeader("Vary", "Accept-Encoding");
    r.setHeader("Vary", "Origin");
    expect(varyOf(r)).to.contain("Origin");
    expect(varyOf(r)).to.contain("Accept-Encoding");
  });

  it("pas de doublon, casse ignorée (les noms d'en-têtes le sont)", () => {
    const r = makeResponse();
    r.setHeader("Vary", "Origin");
    r.setHeader("Vary", "origin");
    expect(varyOf(r)).to.equal("Origin");
  });

  it("une liste déjà composée est fusionnée token par token", () => {
    const r = makeResponse();
    r.setHeader("Vary", "Origin, Accept-Encoding");
    r.setHeader("Vary", "Accept-Language, origin");
    expect(varyOf(r)).to.equal("Origin, Accept-Encoding, Accept-Language");
  });

  it("`*` absorbe tout (il dit déjà « varie sur l'inexprimable »)", () => {
    const r = makeResponse();
    r.setHeader("Vary", "Origin");
    r.setHeader("Vary", "*");
    expect(varyOf(r)).to.equal("*");
  });

  it("un tableau est accepté comme valeur (contrat Node)", () => {
    const r = makeResponse();
    r.setHeader("Vary", ["Origin", "Accept-Encoding"]);
    expect(varyOf(r)).to.equal("Origin, Accept-Encoding");
  });

  it("les AUTRES en-têtes gardent la sémantique de remplacement", () => {
    const r = makeResponse();
    r.setHeader("X-Test", "un");
    r.setHeader("X-Test", "deux");
    const got = (
      r as unknown as { response: { getHeader(n: string): unknown } }
    ).response.getHeader("x-test");
    expect(got).to.equal("deux");
  });
});

describe("writeHead() — filet Content-Type + ligne de statut standard", () => {
  // Harnais dédié : capture les arguments du writeHead natif pour prouver
  // le fast path (message standard NON transmis) et le filet Content-Type.
  function makeCapturingResponse(method = "GET"): {
    r: HttpResponse;
    headers: Record<string, number | string | string[]>;
    writeHeadCalls: unknown[][];
  } {
    const headers: Record<string, number | string | string[]> = {};
    const writeHeadCalls: unknown[][] = [];
    const mockServerResponse = {
      headersSent: false,
      statusMessage: "",
      setHeader: (name: string, value: number | string | string[]) => {
        headers[name.toLowerCase()] = value;
      },
      getHeader: (name: string) => headers[name.toLowerCase()],
      getHeaders: () => ({ ...headers }),
      hasHeader: (name: string) => name.toLowerCase() in headers,
      removeHeader: (name: string) => {
        delete headers[name.toLowerCase()];
      },
      writeHead: (...args: unknown[]) => {
        writeHeadCalls.push(args);
      },
      addTrailers: () => {},
    } as unknown as http.ServerResponse;
    const ctx = {
      type: "http",
      method,
      log: () => undefined,
    } as unknown as HttpContext;
    return {
      r: new HttpResponse(mockServerResponse, ctx),
      headers,
      writeHeadCalls,
    };
  }

  it("émet application/octet-stream quand AUCUN Content-Type n'a été choisi", () => {
    const { r, headers } = makeCapturingResponse();
    r.writeHead(200);
    expect(headers["content-type"]).to.equal("application/octet-stream");
  });

  it("corps posé VIDE : aucun Content-Type (RFC 9110 §8.3)", () => {
    const texte = makeCapturingResponse();
    texte.r.setBody("");
    texte.r.writeHead(202);
    expect(texte.headers).to.not.have.property("content-type");
    const octets = makeCapturingResponse();
    octets.r.setBody(Buffer.alloc(0));
    octets.r.writeHead(405);
    expect(octets.headers).to.not.have.property("content-type");
  });

  it("204 et 304 : aucun Content-Type, même avec un corps posé", () => {
    for (const status of [204, 304]) {
      const { r, headers } = makeCapturingResponse();
      r.setBody("ignoré");
      r.writeHead(status);
      expect(headers).to.not.have.property("content-type");
    }
  });

  it("HEAD à corps vide : le défaut reste, comme sous GET", () => {
    const { r, headers } = makeCapturingResponse("HEAD");
    r.setBody("");
    r.writeHead(200);
    expect(headers["content-type"]).to.equal("application/octet-stream");
  });

  it("corps NON vide sans type : le défaut reste", () => {
    const { r, headers } = makeCapturingResponse();
    r.setBody(Buffer.from([1, 2, 3]));
    r.writeHead(200);
    expect(headers["content-type"]).to.equal("application/octet-stream");
  });

  it("ne touche PAS à un Content-Type déjà choisi", () => {
    const { r, headers } = makeCapturingResponse();
    r.setContentType("application/json", "utf-8");
    r.writeHead(200);
    expect(headers["content-type"]).to.equal("application/json");
  });

  it("message STANDARD : la ligne de statut n'est pas recomposée (2 args)", () => {
    const { r, writeHeadCalls } = makeCapturingResponse();
    r.writeHead(404);
    expect(writeHeadCalls).to.have.length(1);
    // (statusCode, headers) — pas de statusMessage custom transmis à node
    expect(writeHeadCalls[0]![0]).to.equal(404);
    expect(writeHeadCalls[0]![1]).to.not.be.a("string");
  });

  it("message CUSTOM : transmis assaini (3 args)", () => {
    const { r, writeHeadCalls } = makeCapturingResponse();
    r.setStatusCode(403, "Access Denied");
    r.writeHead();
    expect(writeHeadCalls).to.have.length(1);
    expect(writeHeadCalls[0]![0]).to.equal(403);
    expect(writeHeadCalls[0]![1]).to.equal("Access Denied");
  });
});
