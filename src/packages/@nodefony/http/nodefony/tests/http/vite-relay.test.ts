/// <reference types="node" />
/**
 * Intégration (serveur de dev réel) — Vite servi DERRIÈRE Nodefony (#528).
 *
 * `@nodefony/frontend` monte `/_vite/<famille>/` sur le proxy inverse de ce
 * module : modules, images importées et socket du rechargement à chaud sont
 * servis sur l'origine de la page (5152, HTTPS), Vite restant sur la boucle
 * locale. Ce banc éprouve le branchement réel — pipeline HTTP (avant le
 * routage) ET répartiteur d'upgrade — que `unit/reverseProxy.test.ts` éprouve
 * sur un front de test.
 *
 * Décor : le serveur de dev du dépôt, dont la console d'administration est
 * servie par Vite (famille `default`) — `start.sh` du skill
 * `nodefony-start-server`. Le logo de la console, importé depuis le paquet
 * `nodefony`, est l'asset réel éprouvé.
 */
import { describe, it, expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../../../../..");
const LOGO = path
  .join(REPO, "src", "nodefony", "assets", "nodefony-logo.png")
  .replace(/\\/g, "/");
// Chemin `/@fs` tel que Vite l'écrit (`/@fs/C:/…` sous Windows).
const LOGO_PATH = `/_vite/default/@fs${LOGO.startsWith("/") ? "" : "/"}${LOGO}`;

interface IRaw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function request(url: string, host?: string): Promise<IRaw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        rejectUnauthorized: false,
        headers: host ? { Host: host } : {},
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(IS_PROD_TARGET)(
  "Vite derrière Nodefony : /_vite/<famille>/ relayé (#528)",
  () => {
    it("une image importée est servie PAR NODEFONY, sur l'origine de la page", async () => {
      const res = await request(`https://127.0.0.1:5152${LOGO_PATH}`);
      expect(
        res.status,
        "le proxy n'est pas monté (frontend absent ?)",
      ).to.equal(200);
      expect(String(res.headers["content-type"])).to.include("image/png");
      expect(res.body.subarray(0, 4).toString("hex")).to.equal("89504e47");
      // Relayée, pas redirigée : aucune autre origine n'est révélée.
      expect(res.headers.location).to.equal(undefined);
      expect(String(res.headers.via)).to.match(/nodefony-[0-9a-f]{8}/);
    });

    it("le client Vite est servi relayé (module JavaScript)", async () => {
      const res = await request(
        "https://127.0.0.1:5152/_vite/default/@vite/client",
      );
      expect(res.status).to.equal(200);
      expect(String(res.headers["content-type"])).to.include("javascript");
    });

    it("le socket du rechargement à chaud s'ouvre sur l'origine de la page (wss://…:5152)", async () => {
      const client = await request(
        "https://127.0.0.1:5152/_vite/default/@vite/client",
      );
      const token = /const wsToken = "([^"]+)"/.exec(
        client.body.toString(),
      )?.[1];
      expect(token, "jeton HMR introuvable dans @vite/client").to.be.a(
        "string",
      );
      const ws = new WebSocket(
        `wss://127.0.0.1:5152/_vite/default/?token=${token}`,
        "vite-hmr",
        { rejectUnauthorized: false, origin: "https://127.0.0.1:5152" },
      );
      try {
        const first = await new Promise<string>((resolve, reject) => {
          ws.once("message", (m) => resolve((m as Buffer).toString()));
          ws.once("error", reject);
          ws.once("unexpected-response", (_q, r) =>
            reject(new Error(`HTTP ${r.statusCode}`)),
          );
        });
        expect(ws.protocol).to.equal("vite-hmr");
        // Premier message de Vite : `{"type":"connected"}`.
        expect(JSON.parse(first)).to.include({ type: "connected" });
      } finally {
        ws.terminate();
      }
    });

    it("une méthode d'écriture n'est pas relayée (Vite ne sert que des lectures)", async () => {
      const res = await new Promise<number>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "127.0.0.1",
            port: 5152,
            path: "/_vite/default/@vite/client",
            method: "POST",
            rejectUnauthorized: false,
          },
          (r) => {
            r.resume();
            resolve(r.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end("x");
      });
      expect(res).to.not.equal(200);
    });

    it("chemin ambigu sous le préfixe → 400, Vite n'est pas contacté", async () => {
      const res = await request(
        "https://127.0.0.1:5152/_vite/default/..%2f..%2fetc/passwd",
      );
      expect(res.status).to.equal(400);
    });

    it("Host forgé : jamais relayé hors de la barrière d'hôte", async () => {
      // Avec `domainCheck` (dépôt) la barrière répond 421 ; sans, la requête
      // est relayée vers Vite LOCAL — la cible ne vient jamais du client.
      const res = await request(
        `https://127.0.0.1:5152${LOGO_PATH}`,
        "evil.example",
      );
      expect([200, 421]).to.include(res.status);
      expect(res.headers.location).to.equal(undefined);
    });

    it("préfixe d'une famille inexistante → pas relayé", async () => {
      const res = await request("https://127.0.0.1:5152/_vite/inconnue/x.png");
      expect(res.headers.via).to.equal(undefined);
    });
  },
);

describe.runIf(IS_PROD_TARGET)("/_vite/ en PRODUCTION", () => {
  it("jamais relayé : Vite ne tourne pas, aucun montage n'est déclaré", async () => {
    const res = await request(`https://127.0.0.1:5152${LOGO_PATH}`);
    expect(res.status).to.equal(404);
    expect(res.headers.via).to.equal(undefined);
  });
});
