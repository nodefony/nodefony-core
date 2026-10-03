/// <reference types="node" />
import { expect } from "vitest";
import HttpKernel from "../../service/http-kernel.js";
import HttpContext, {
  switchUrlScheme,
} from "../../src/context/http/HttpContext.js";

// `redirectHttps()` / `redirectHttp()` — changement de schéma d'une URL.
// Avant : `extend({}, request.url, …)` ne copiait RIEN d'un `URL` (accesseurs
// du prototype) → `Location: https:` ; et le port venait de `httpKernel.
// httpsPort`, champ jamais écrit → toujours 443. Montage minimal :
// `Object.create(X.prototype)` + doublures, sans serveur.

type Loose = Record<string, unknown>;

describe("switchUrlScheme — même URL, autre schéma", () => {
  const from = new URL("http://localhost:5151/a/b?x=1#h");

  it("garde hôte, chemin et requête ; pose le port donné", () => {
    expect(switchUrlScheme(from, "https", 5152)).to.equal(
      "https://localhost:5152/a/b?x=1#h",
    );
  });

  it("port absent → port par défaut du schéma, omis de l'URL", () => {
    expect(switchUrlScheme(from, "https")).to.equal(
      "https://localhost/a/b?x=1#h",
    );
  });

  it("port égal au défaut du schéma → omis", () => {
    expect(switchUrlScheme(from, "https", 443)).to.equal(
      "https://localhost/a/b?x=1#h",
    );
  });
});

describe("HttpContext.redirectHttps / redirectHttp", () => {
  function context(proxy: boolean, ports: Loose): Loose {
    const ctx = Object.create(HttpContext.prototype) as Loose;
    ctx.request = { url: new URL("http://example.test:5151/p?q=2") };
    ctx.proxy = proxy;
    ctx.httpKernel = ports;
    ctx.redirect = (location: string) => location;
    return ctx;
  }
  const call = (ctx: Loose, name: "redirectHttps" | "redirectHttp") =>
    (HttpContext.prototype[name] as unknown as () => string).call(ctx);

  it("hors proxy → port du serveur HTTPS lié", () => {
    expect(call(context(false, { httpsPort: 5152 }), "redirectHttps")).to.equal(
      "https://example.test:5152/p?q=2",
    );
  });

  it("derrière un proxy → port par défaut (port public inconnu)", () => {
    expect(call(context(true, { httpsPort: 5152 }), "redirectHttps")).to.equal(
      "https://example.test/p?q=2",
    );
  });

  it("redirectHttp → port du serveur HTTP lié", () => {
    expect(call(context(false, { httpPort: 8080 }), "redirectHttp")).to.equal(
      "http://example.test:8080/p?q=2",
    );
  });
});

describe("HttpKernel.httpPort / httpsPort — lus sur le serveur lié", () => {
  function kernel(servers: Record<string, unknown>): HttpKernel {
    const k = Object.create(HttpKernel.prototype) as Loose;
    k.get = (name: string) => servers[name] ?? null;
    return k as unknown as HttpKernel;
  }

  it("serveur actif → son port", () => {
    const k = kernel({
      "server-https": { active: true, port: 5152 },
      "server-http": { active: true, port: 5151 },
    });
    expect(k.httpsPort).to.equal(5152);
    expect(k.httpPort).to.equal(5151);
  });

  it("serveur inactif ou absent → undefined", () => {
    const k = kernel({ "server-https": { active: false, port: 5152 } });
    expect(k.httpsPort).to.equal(undefined);
    expect(k.httpPort).to.equal(undefined);
  });
});
