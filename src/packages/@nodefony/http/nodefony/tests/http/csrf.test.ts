/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * CSRF (P6 J5) — banc d'INTÉGRATION RÉEL contre le serveur live (port 5151).
 * Prouve le câblage de bout en bout (`firewall.enforceCsrf` dans le pipeline
 * http-kernel), pas seulement la logique pure (couverte par security/csrf.test).
 *
 * Route cible : `POST /nodefony/test/fw/post-only` — publique (hors zone firewall)
 * → isole la défense CSRF de l'authentification. Host effectif = `localhost:5151`.
 */

const BASE = { hostname: "localhost", port: 5151 };
const PATH = "/nodefony/test/fw/post-only";
const SELF = "http://localhost:5151"; // origine same-host (Host posé par node:http)

function status(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.statusCode!));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("CSRF — défense Fetch Metadata + repli Origin (intégration live)", () => {
  it("POST sans en-tête (client non-navigateur) → autorisé", async () => {
    expect(await status("POST", PATH)).to.not.equal(403);
  });

  it("POST Sec-Fetch-Site: cross-site → 403 (mutation tierce bloquée)", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "cross-site" }),
    ).to.equal(403);
  });

  it("POST Sec-Fetch-Site: same-origin → autorisé", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "same-origin" }),
    ).to.not.equal(403);
  });

  it("POST Sec-Fetch-Site: same-site → autorisé (tolérant par défaut)", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "same-site" }),
    ).to.not.equal(403);
  });

  it("POST Origin étranger sans Sec-Fetch (repli) → 403", async () => {
    expect(await status("POST", PATH, { Origin: "https://evil.com" })).to.equal(
      403,
    );
  });

  it("POST Origin same-host (repli) → autorisé", async () => {
    expect(await status("POST", PATH, { Origin: SELF })).to.not.equal(403);
  });

  it("POST Referer étranger (repli, Origin absent) → 403", async () => {
    expect(
      await status("POST", PATH, { Referer: "https://evil.com/attack" }),
    ).to.equal(403);
  });

  it("POST Referer same-host (repli) → autorisé", async () => {
    expect(
      await status("POST", PATH, { Referer: `${SELF}/form` }),
    ).to.not.equal(403);
  });

  it("PUT cross-site → 403 (méthode mutante, route /html/upload)", async () => {
    expect(
      await status("PUT", "/nodefony/test/html/upload", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.equal(403);
  });

  it("DELETE cross-site → 403 (méthode mutante, route /fw/delete-only)", async () => {
    expect(
      await status("DELETE", "/nodefony/test/fw/delete-only", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.equal(403);
  });

  it("GET cross-site → JAMAIS 403 (méthode sûre, RFC 9110)", async () => {
    expect(
      await status("GET", "/nodefony/test/index", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.not.equal(403);
  });
});

// ── CSRF étape 2 — synchronizer token (@CsrfProtect) + @CsrfExempt ──────────────

interface FullResponse {
  status: number;
  setCookie: string[];
  body: string;
}
function full(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<FullResponse> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const raw = res.headers["set-cookie"];
        resolve({
          status: res.statusCode!,
          setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [],
          body,
        });
      });
    });
    r.on("error", reject);
    r.end();
  });
}
const TOKEN_PATH = "/nodefony/test/fw/csrf/token";
const SUBMIT_PATH = "/nodefony/test/fw/csrf/submit";
const cookieVal = (setCookie: string[], name: string): string | undefined => {
  const line = setCookie.find((c) => c.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).split(";")[0] : undefined;
};

describe("CSRF synchronizer token (@CsrfProtect) — flow double-submit live", () => {
  it("GET protégé émet le cookie csrf-token + le token dans le corps", async () => {
    const res = await full("GET", TOKEN_PATH);
    expect(res.status).to.equal(200);
    const cookie = cookieVal(res.setCookie, "csrf-token");
    expect(cookie, "cookie csrf-token posé").to.be.a("string");
    const token = JSON.parse(res.body).token as string;
    expect(token).to.be.a("string");
    expect(token).to.equal(cookie); // double-submit : corps ≡ cookie
  });

  it("DOUBLE COOKIE : la réponse porte session + csrf-token (flush multi-cookie)", async () => {
    const res = await full("GET", TOKEN_PATH);
    expect(res.setCookie.length, JSON.stringify(res.setCookie)).to.be.at.least(
      2,
    );
    expect(cookieVal(res.setCookie, "csrf-token")).to.be.a("string");
    // un 2ᵉ cookie (session) coexiste — aucun écrasé par l'autre.
    expect(res.setCookie.some((c) => !c.startsWith("csrf-token="))).to.equal(
      true,
    );
  });

  it("POST protégé SANS token → 403", async () => {
    expect((await full("POST", SUBMIT_PATH)).status).to.equal(403);
  });

  it("POST protégé header ≡ cookie + HMAC valide → 200", async () => {
    const token = cookieVal(
      (await full("GET", TOKEN_PATH)).setCookie,
      "csrf-token",
    )!;
    const res = await full("POST", SUBMIT_PATH, {
      "x-csrf-token": token,
      cookie: `csrf-token=${token}`,
    });
    expect(res.status).to.equal(200);
  });

  it("POST protégé header SANS cookie (double-submit cassé) → 403", async () => {
    const token = cookieVal(
      (await full("GET", TOKEN_PATH)).setCookie,
      "csrf-token",
    )!;
    expect(
      (await full("POST", SUBMIT_PATH, { "x-csrf-token": token })).status,
    ).to.equal(403);
  });

  it("POST protégé header ≠ cookie → 403", async () => {
    const token = cookieVal(
      (await full("GET", TOKEN_PATH)).setCookie,
      "csrf-token",
    )!;
    expect(
      (
        await full("POST", SUBMIT_PATH, {
          "x-csrf-token": token,
          cookie: "csrf-token=AAAA.BBBB",
        })
      ).status,
    ).to.equal(403);
  });

  it("POST protégé token à signature falsifiée → 403", async () => {
    const token = cookieVal(
      (await full("GET", TOKEN_PATH)).setCookie,
      "csrf-token",
    )!;
    const forged = `${token.split(".")[0]}.ZZZZZZZZZZZZZZZZZZZZZZZZZZZ`;
    expect(
      (
        await full("POST", SUBMIT_PATH, {
          "x-csrf-token": forged,
          cookie: `csrf-token=${forged}`,
        })
      ).status,
    ).to.equal(403);
  });
});

describe("CSRF @CsrfExempt — opt-out ciblé (auth conservée)", () => {
  it("POST cross-site sur route EXEMPTÉE → PAS 403 (webhook légitime)", async () => {
    expect(
      await status("POST", "/nodefony/test/fw/csrf/webhook", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.not.equal(403);
  });

  it("CONTRASTE : POST cross-site sur route NON exemptée → 403", async () => {
    expect(
      await status("POST", "/nodefony/test/fw/post-only", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.equal(403);
  });
});
