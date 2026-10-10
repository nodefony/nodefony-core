/// <reference types="node" />
/**
 * Integration — la page de connexion par défaut, servie par le framework.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * Le décor est celui du dépôt : la zone `test-login-guarded`
 * (`src/modules/test/nodefony/config/config.ts`) FERME `/login` et les fichiers
 * de la page, comme une application qui protège `^/`. La page doit pourtant
 * répondre à un anonyme. Le TÉMOIN — une route ordinaire sous la même zone,
 * refusée — prouve que la zone mord : sans lui, ce banc passerait aussi sur un
 * serveur où la zone n'existe plus. Les fichiers, eux, passent par le service
 * statique, consulté avant le pare-feu : ils sont publics par construction.
 */
import { expect } from "vitest";
import https from "node:https";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: string };

function get(path: string, method = "GET"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

const attr = (html: string, pattern: RegExp): string | undefined =>
  pattern.exec(html)?.[1];

describe("page de connexion par défaut — servie derrière une zone fermée", () => {
  it("🔴 le témoin : la zone refuse un anonyme sur une route ordinaire", async () => {
    const res = await get("/nodefony/test/login-guarded");
    expect(res.status).toBe(401);
  });

  it("🔴 ni la casse ni la barre finale ne sortent de la zone (CWE-178)", async () => {
    // Le routeur sert ces formes comme la route nominale : la zone doit les
    // couvrir aussi, sinon l'action tourne en anonyme.
    for (const path of [
      "/nodefony/test/LOGIN-GUARDED",
      "/NODEFONY/TEST/login-guarded",
      "/nodefony/test/login-guarded/",
      "/nodefony/test/SECURE/whoami",
    ]) {
      expect((await get(path)).status, path).toBe(401);
    }
  });

  it("🔴 un anonyme reçoit la page : HTML, jamais en cache, jamais dans un cadre", async () => {
    const res = await get("/login");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(String(res.headers["content-security-policy"])).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.body).toContain('data-step="identifier"');
  });

  it("🔴 le script porte le nonce de la politique de contenu de CETTE réponse", async () => {
    const res = await get("/login");
    const nonce = attr(res.body, /<script[^>]*nonce="([^"]+)"/u);
    expect(nonce).toBeDefined();
    expect(String(res.headers["content-security-policy"])).toContain(
      `'nonce-${nonce ?? ""}'`,
    );
  });

  it("🔴 `?from=` hors de l'origine est réécrit en `/` avant d'entrer dans la page", async () => {
    const hostile = await get(
      `/login?from=${encodeURIComponent("//evil.example")}`,
    );
    expect(attr(hostile.body, /data-from="([^"]*)"/u)).toBe("/");
    const local = await get(
      `/login?from=${encodeURIComponent("/nodefony/test/secure")}`,
    );
    expect(attr(local.body, /data-from="([^"]*)"/u)).toBe(
      "/nodefony/test/secure",
    );
  });

  it("🔴 script, feuille et logo répondent à un anonyme, avec leur type", async () => {
    const page = await get("/login");
    const script = attr(page.body, /<script[^>]*src="([^"]+)"/u);
    const style = attr(page.body, /<link rel="stylesheet" href="([^"]+)"/u);
    const logo = attr(page.body, /<link rel="icon" href="([^"]+)"/u);
    for (const [href, type] of [
      [script, "javascript"],
      [style, "text/css"],
      [logo, "image/svg+xml"],
    ] as const) {
      expect(href, type).toMatch(
        /^\/nodefony\/security\/login\/[a-z.-]+\?v=[0-9a-f]{12}$/u,
      );
      const res = await get(href ?? "");
      expect(res.status, href).toBe(200);
      expect(String(res.headers["content-type"]), href).toContain(type);
    }
  });

  it("HEAD répond comme GET, sans corps", async () => {
    const res = await get("/login", "HEAD");
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });
});
