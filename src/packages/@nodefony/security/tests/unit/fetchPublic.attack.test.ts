import assert from "node:assert/strict";
import { createServer, type Server, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, deflateSync } from "node:zlib";
import { fetchPublic } from "../../nodefony/src/net/fetchPublic";
import { FetchPublicError } from "../../nodefony/errors/FetchPublicError";
import { SsrfError } from "../../nodefony/errors/SsrfError";
import { deliverWebhook } from "../../nodefony/src/webhook/webhookDelivery";

/**
 * Red-team de `fetchPublic` (SSRF) — matrice écrite depuis OWASP « SSRF
 * Prevention Cheat Sheet » et les RFC 9110 (redirections), 3986 (notations
 * d'adresse), 9112 (contenu), AVANT la lecture de la primitive. Le serveur
 * local est la CIBLE INTERDITE : toute requête qui lui parvient sans y avoir
 * été autorisée est une faille.
 */

let server: Server;
let port = 0;
const hits = new Map<string, number>();
const seen = new Map<string, IncomingHttpHeaders>();
/** Le serveur a vu la connexion de `/infinite` se fermer : un FAIT attendu, jamais sondé. */
let infiniteClosed = Promise.withResolvers<void>();
const GZ = gzipSync(Buffer.alloc(50 * 1024 * 1024));
const DEFLATE = deflateSync(Buffer.alloc(50 * 1024 * 1024));

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    seen.set(url.pathname, req.headers);
    req.resume();
    if (url.pathname === "/redir") {
      res.writeHead(Number(url.searchParams.get("code") ?? 302), {
        location: url.searchParams.get("to") ?? "/ok",
      });
      res.end();
    } else if (url.pathname === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (url.pathname === "/drip") {
      res.writeHead(200);
      let n = 0;
      const timer = setInterval(() => {
        res.write("x");
        if (++n >= 24) {
          clearInterval(timer);
          res.end();
        }
      }, 500);
      res.on("close", () => clearInterval(timer));
    } else if (url.pathname === "/infinite") {
      res.writeHead(200);
      const chunk = Buffer.alloc(16 * 1024, 0x61);
      const pump = (): void => {
        while (!res.destroyed && res.write(chunk)) {
          /* remplit jusqu'à la contre-pression */
        }
        if (!res.destroyed) res.once("drain", pump);
      };
      res.on("close", () => {
        infiniteClosed.resolve();
      });
      pump();
    } else if (url.pathname === "/method") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(req.method);
    } else if (url.pathname === "/gzip") {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(GZ);
    } else if (url.pathname === "/deflate") {
      res.writeHead(200, { "content-encoding": "deflate" });
      res.end(DEFLATE);
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  hits.clear();
  seen.clear();
  infiniteClosed = Promise.withResolvers<void>();
});

/** Le serveur local joue un hôte « public » dont l'IP a déjà été vérifiée. */
const PUBLIC = { allowHttp: true, vettedAddresses: ["127.0.0.1"] } as const;
const hitCount = (path: string): number => hits.get(path) ?? 0;

const resolver =
  (table: Record<string, string[]>) =>
  async (host: string): Promise<string[]> => {
    const found = table[host];
    if (found === undefined) throw new Error("nxdomain");
    return found;
  };

describe("fetchPublic — adresses internes (OWASP SSRF, RFC 3986)", () => {
  const forbidden: Array<[string, () => string]> = [
    ["IPv4 loopback", () => `http://127.0.0.1:${port}/secret`],
    ["IPv6 loopback", () => `http://[::1]:${port}/secret`],
    ["IPv4-mapped IPv6", () => `http://[::ffff:127.0.0.1]:${port}/secret`],
    ["métadonnées cloud", () => "http://169.254.169.254/latest/meta-data/"],
    ["0.0.0.0", () => `http://0.0.0.0:${port}/secret`],
    ["décimal 2130706433", () => `http://2130706433:${port}/secret`],
    ["octal 0177.0.0.1", () => `http://0177.0.0.1:${port}/secret`],
    ["hexadécimal 0x7f.1", () => `http://0x7f.1:${port}/secret`],
    ["réseau privé 10.x", () => "http://10.0.0.1/"],
    ["réseau privé 192.168.x", () => "http://192.168.1.1/"],
  ];
  for (const [label, rawUrl] of forbidden) {
    it(`${label} → SsrfError, aucune requête émise`, async () => {
      const url = rawUrl();
      await assert.rejects(
        fetchPublic(url, { allowHttp: true, timeoutMs: 1000 }),
        SsrfError,
      );
      assert.equal(hitCount("/secret"), 0);
    });
  }

  it("nom résolu en interne → SsrfError", async () => {
    await assert.rejects(
      fetchPublic(`http://internal.test:${port}/secret`, {
        allowHttp: true,
        resolver: resolver({ "internal.test": ["127.0.0.1"] }),
      }),
      SsrfError,
    );
    assert.equal(hitCount("/secret"), 0);
  });

  it("nom à une IP publique ET une interne → SsrfError (toutes jugées)", async () => {
    await assert.rejects(
      fetchPublic(`http://mixed.test:${port}/secret`, {
        allowHttp: true,
        resolver: resolver({ "mixed.test": ["1.1.1.1", "127.0.0.1"] }),
      }),
      SsrfError,
    );
  });

  it("hôte sans adresse → `unresolvable` ; cible interdite → `forbidden`", async () => {
    await assert.rejects(
      fetchPublic("http://nowhere.test/", {
        allowHttp: true,
        resolver: resolver({}),
      }),
      (e: unknown) => e instanceof SsrfError && e.reason === "unresolvable",
    );
    await assert.rejects(
      fetchPublic("http://10.0.0.1/", { allowHttp: true }),
      (e: unknown) => e instanceof SsrfError && e.reason === "forbidden",
    );
  });

  it("identifiants dans l'URL → SsrfError", async () => {
    await assert.rejects(
      fetchPublic(`http://user:pw@pub.test:${port}/ok`, PUBLIC),
      SsrfError,
    );
    assert.equal(hitCount("/ok"), 0);
  });

  it("protocole file: et gopher: refusés d'emblée", async () => {
    await assert.rejects(fetchPublic("file:///etc/passwd", PUBLIC), SsrfError);
    await assert.rejects(
      fetchPublic("gopher://127.0.0.1:70/_x", PUBLIC),
      SsrfError,
    );
  });

  it("http refusé sans allowHttp", async () => {
    await assert.rejects(
      fetchPublic(`http://pub.test:${port}/ok`, {
        vettedAddresses: ["127.0.0.1"],
      }),
      SsrfError,
    );
  });
});

describe("fetchPublic — rebinding DNS : la connexion va à l'IP VÉRIFIÉE", () => {
  it("1re résolution publique, 2e interne → la 2e n'a jamais lieu", async () => {
    let calls = 0;
    await assert.rejects(
      fetchPublic(`http://localhost:${port}/secret`, {
        allowHttp: true,
        timeoutMs: 600,
        resolver: async () => {
          calls++;
          return calls === 1 ? ["1.1.1.1"] : ["127.0.0.1"];
        },
      }),
      FetchPublicError,
    );
    assert.equal(calls, 1, "une seule résolution par hôte");
    assert.equal(hitCount("/secret"), 0, "jamais connecté à l'IP interne");
  });

  it("contrôle positif : un nom inexistant est joint par l'IP épinglée", async () => {
    const r = await fetchPublic(`http://pin.invalid:${port}/ok`, PUBLIC);
    assert.equal(r.status, 200);
    assert.equal(new TextDecoder().decode(r.body), "ok");
    assert.equal(seen.get("/ok")?.host, `pin.invalid:${port}`);
    assert.equal(seen.get("/ok")?.cookie, undefined);
    assert.equal(seen.get("/ok")?.authorization, undefined);
    assert.equal(seen.get("/ok")?.["accept-encoding"], "identity");
  });
});

describe("fetchPublic — redirections (RFC 9110 §15.4)", () => {
  const base = (): string => `http://pub.test:${port}`;
  const targets: Array<[string, () => string]> = [
    ["loopback", () => `http://127.0.0.1:${port}/secret`],
    ["métadonnées cloud", () => "http://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback", () => `http://[::1]:${port}/secret`],
    ["file:", () => "file:///etc/passwd"],
    ["gopher:", () => "gopher://127.0.0.1:70/_x"],
    ["identifiants", () => `http://u:p@pub.test:${port}/secret`],
    ["Location illisible", () => "http://[::1"],
  ];
  for (const [label, target] of targets) {
    it(`public → ${label} → SsrfError, cible non jointe`, async () => {
      await assert.rejects(
        fetchPublic(`${base()}/redir?to=${encodeURIComponent(target())}`, {
          ...PUBLIC,
          maxRedirects: 3,
        }),
        SsrfError,
      );
      assert.equal(hitCount("/secret"), 0);
    });
  }

  it("public → nom résolu en interne → SsrfError", async () => {
    await assert.rejects(
      fetchPublic(
        `${base()}/redir?to=${encodeURIComponent(`http://internal.test:${port}/secret`)}`,
        {
          ...PUBLIC,
          maxRedirects: 3,
          resolver: resolver({ "internal.test": ["10.0.0.5"] }),
        },
      ),
      SsrfError,
    );
  });

  it("boucle → FetchPublicError « too-many-redirects », bornée", async () => {
    await assert.rejects(
      fetchPublic(`${base()}/loop`, { ...PUBLIC, maxRedirects: 3 }),
      (e: unknown) =>
        e instanceof FetchPublicError && e.reason === "too-many-redirects",
    );
    assert.equal(hitCount("/loop"), 4);
  });

  it("défaut : aucune redirection suivie, le 3xx est rendu", async () => {
    const r = await fetchPublic(
      `${base()}/redir?to=${encodeURIComponent("http://169.254.169.254/")}`,
      PUBLIC,
    );
    assert.equal(r.status, 302);
    assert.equal(r.redirects, 0);
  });

  it("Location relative résolue, sans cookie ni Authorization conservés", async () => {
    const r = await fetchPublic(`${base()}/redir?to=/ok`, {
      ...PUBLIC,
      maxRedirects: 2,
      headers: { Cookie: "sid=1", Authorization: "Bearer t", "X-Keep": "1" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.redirects, 1);
    assert.equal(r.url.pathname, "/ok");
    assert.equal(
      seen.get("/redir")?.cookie,
      "sid=1",
      "le saut 1 porte ce que l'appelant a voulu",
    );
    assert.equal(seen.get("/ok")?.cookie, undefined);
    assert.equal(seen.get("/ok")?.authorization, undefined);
    assert.equal(seen.get("/ok")?.["x-keep"], "1");
  });

  it("303 sur PUT → GET (RFC 9110 §15.4.4) ; 307 garde la méthode", async () => {
    const via = (code: number) =>
      fetchPublic(`${base()}/redir?to=/method&code=${code}`, {
        ...PUBLIC,
        maxRedirects: 1,
        method: "PUT",
      });
    assert.equal(new TextDecoder().decode((await via(303)).body), "GET");
    assert.equal(new TextDecoder().decode((await via(307)).body), "PUT");
  });

  it("303 sur POST → GET sans corps", async () => {
    const r = await fetchPublic(`${base()}/redir?to=/ok&code=303`, {
      ...PUBLIC,
      maxRedirects: 2,
      method: "POST",
      body: "secret-body",
    });
    assert.equal(r.status, 200);
    assert.equal(seen.get("/ok")?.["content-length"], undefined);
  });
});

describe("fetchPublic — consommation bornée (OWASP LLM10)", () => {
  it("goutte-à-goutte (1 octet / 500 ms) → coupé au délai TOTAL", async () => {
    const t0 = Date.now();
    await assert.rejects(
      fetchPublic(`http://pub.test:${port}/drip`, {
        ...PUBLIC,
        timeoutMs: 1500,
      }),
      (e: unknown) => e instanceof FetchPublicError && e.reason === "timeout",
    );
    assert.ok(Date.now() - t0 < 3500, "coupé au délai, pas à la fin du flux");
  });

  it("résolution DNS qui pend → coupée au délai total", async () => {
    const t0 = Date.now();
    await assert.rejects(
      fetchPublic(`http://hang.test:${port}/ok`, {
        allowHttp: true,
        timeoutMs: 400,
        resolver: () => new Promise<string[]>(() => undefined),
      }),
      (e: unknown) => e instanceof FetchPublicError && e.reason === "timeout",
    );
    assert.ok(Date.now() - t0 < 2000);
  });

  it("corps infini → coupé à maxBytes, connexion DÉTRUITE", async () => {
    const r = await fetchPublic(`http://pub.test:${port}/infinite`, {
      ...PUBLIC,
      maxBytes: 65536,
      timeoutMs: 5000,
    });
    assert.equal(r.truncated, true);
    assert.equal(r.body.length, 65536);
    // Le serveur voit la connexion fermée ; sinon le délai du test tombe.
    await infiniteClosed.promise;
  });

  for (const [name, path, raw] of [
    ["gzip", "/gzip", GZ],
    ["deflate", "/deflate", DEFLATE],
  ] as const) {
    it(`${name} jamais décodé : octets reçus tels quels, pas de bombe`, async () => {
      const r = await fetchPublic(`http://pub.test:${port}${path}`, {
        ...PUBLIC,
        maxBytes: 1024 * 1024,
      });
      assert.equal(r.truncated, false);
      assert.equal(r.body.length, raw.length);
      assert.ok(r.body.length < 1024 * 1024, "le corps reste minuscule");
      assert.equal(r.headers["content-encoding"], name);
    });
  }

  it("options absurdes refusées (maxBytes négatif, délai nul)", async () => {
    await assert.rejects(
      fetchPublic("https://a.test/", { maxBytes: -1 }),
      RangeError,
    );
    await assert.rejects(
      fetchPublic("https://a.test/", { timeoutMs: 0 }),
      RangeError,
    );
  });
});

describe("deliverWebhook — délai TOTAL (défaut trouvé à la relecture)", () => {
  it("destinataire qui goutte un octet / 500 ms → livraison coupée au délai", async () => {
    const t0 = Date.now();
    const r = await deliverWebhook(
      `http://h.invalid:${port}/drip`,
      "{}",
      {},
      { timeoutMs: 1500, addresses: ["127.0.0.1"], allowHttp: true },
    );
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.status, null);
    assert.ok(elapsed < 3500, `coupé au délai total, pas après ${elapsed} ms`);
  });

  it("corps infini → lecture coupée, livraison rendue", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/infinite`,
      "{}",
      {},
      { timeoutMs: 3000, addresses: ["127.0.0.1"], allowHttp: true },
    );
    assert.equal(r.status, 200);
    assert.ok((r.responseBody ?? "").length <= 2048);
    // Connexion détruite, pas drainée : le serveur la voit se fermer.
    await infiniteClosed.promise;
  });
});
