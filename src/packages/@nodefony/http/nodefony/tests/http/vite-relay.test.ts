/// <reference types="node" />
/**
 * Intégration (serveur de dev réel) — relais `/_vite/<famille>/` (#526).
 *
 * En développement, Vite fabrique ses URLs d'assets RELATIVES AU DOCUMENT : une
 * image importée devient `/_vite/default/…`, que le navigateur demande à
 * Nodefony (la page vient de lui). Nodefony la renvoie en 307 vers le serveur
 * Vite, sur l'origine qu'aurait annoncée la page à ce client.
 *
 * Décor : le serveur de dev du dépôt, dont la console d'administration est
 * servie par Vite (famille `default`) — `start.sh` du skill
 * `nodefony-start-server`. Le logo de la console, importé depuis le paquet
 * `nodefony`, est l'asset réel éprouvé.
 */
import { describe, it, expect } from "vitest";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

describe("relais /_vite/<famille>/ vers Vite (#526)", () => {
  it("une URL d'asset Vite demandée à Nodefony → 307 vers Vite, non mise en cache", async () => {
    const res = await request(`https://127.0.0.1:5152${LOGO_PATH}`);
    expect(res.status, "le relais n'est pas posé (frontend absent ?)").to.equal(
      307,
    );
    const location = String(res.headers.location);
    const target = new URL(location);
    expect(target.hostname).to.equal("127.0.0.1");
    expect(target.port).to.not.equal("5152");
    expect(target.pathname).to.equal(LOGO_PATH);
    expect(String(res.headers["cache-control"])).to.include("no-store");
  });

  it("la cible sert l'image (la boucle complète que fait le navigateur)", async () => {
    const res = await request(`https://127.0.0.1:5152${LOGO_PATH}`);
    const img = await request(String(res.headers.location));
    expect(img.status).to.equal(200);
    expect(String(img.headers["content-type"])).to.include("image/png");
    // Signature PNG.
    expect(img.body.subarray(0, 4).toString("hex")).to.equal("89504e47");
  });

  it("la cible suit l'hôte du client (loopback recomposé sur le port Vite)", async () => {
    const res = await request(
      `https://127.0.0.1:5152${LOGO_PATH}`,
      "localhost:5152",
    );
    expect(res.status).to.equal(307);
    expect(new URL(String(res.headers.location)).hostname).to.equal(
      "localhost",
    );
  });

  it("Host hors trustedHosts → jamais relayé (421 comme toute requête)", async () => {
    const res = await request(
      `https://127.0.0.1:5152${LOGO_PATH}`,
      "evil.example",
    );
    expect(res.status).to.equal(421);
    expect(res.headers.location).to.equal(undefined);
  });

  it("préfixe d'une famille inexistante → pas de relais", async () => {
    const res = await request("https://127.0.0.1:5152/_vite/inconnue/x.png");
    expect(res.status).to.not.equal(307);
  });
});
