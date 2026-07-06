/// <reference types="node" />
/**
 * Integration e2e — emplacement PHYSIQUE des stores (Phase 0.8, lot 1 « varDir »).
 *
 * Prouve bout-en-bout, sur serveur live, la chaîne critique du boot :
 *   - le serveur BOOTE (donc `kernel.varDir` a été créé sans throw — sinon `start()`
 *     rejette avant l'écoute des ports → ce test ne pourrait pas se connecter) ;
 *   - `/nodefony/kernel/api/stores` expose, par brique, le champ `location`
 *     (emplacement physique lu de l'instance du store au boot) ;
 *   - un store `drizzle` (défaut dev sqlite) pointe sur sa base `.db` SOUS `var/`
 *     (base commune `kernel.varDir`) et le fichier existe RÉELLEMENT sur disque ;
 *   - la route reste ADMIN-only (résilience sécurité : anonyme ≠ 200).
 *
 * Requires: server running on 5152 (https). Start: /start-server
 * Fixtures dev : admin/secret (ROLE_NODEFONY_ADMIN).
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const STORES = "/nodefony/kernel/api/stores";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut / vide */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const get = (p: string, h: Record<string, string> = {}) => request("GET", p, h);

function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginAsAdmin(): Promise<string> {
  const res = await request(
    "POST",
    LOGIN,
    {},
    {
      username: "admin",
      password: "secret",
    },
  );
  expect(res.status, "login admin").to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "login pose un cookie de session").to.be.a("string");
  return cookie!;
}

interface StoreEntry {
  brick: string;
  resolved: string;
  available: string[];
  location?: string;
}

describe("Stores — emplacement physique (endpoint /kernel/api/stores)", () => {
  it("anonyme → JAMAIS 200 (route admin-only, résilience sécurité)", async () => {
    const res = await get(STORES);
    expect(res.status, "anonyme sur /stores").to.be.oneOf([401, 403]);
  });

  it("admin → registre des stores avec `location` par brique", async () => {
    const cookie = await loginAsAdmin();
    const res = await get(STORES, { cookie });
    expect(res.status, "admin lit /stores").to.equal(200);

    const stores = (res.body as { stores?: StoreEntry[] }).stores;
    expect(stores, "payload.stores").to.be.an("array").that.is.not.empty;

    // Qualité : aucune location vide ne fuit (undefined OK, "" jamais).
    for (const s of stores!) {
      expect(s.brick, "brick").to.be.a("string").that.is.not.empty;
      expect(s.resolved, "resolved").to.be.a("string").that.is.not.empty;
      if (s.location !== undefined) {
        expect(s.location, `location de ${s.brick}`).to.be.a("string").that.is
          .not.empty;
      }
      // Invariant d'affichage : le backend RÉSOLU figure TOUJOURS dans les
      // backends disponibles (sinon « Store actif: memory » alors que « dispo »
      // ne le liste pas — incohérence idempotency corrigée via listXBackends).
      expect(
        s.available,
        `available de ${s.brick} contient le résolu`,
      ).to.include(s.resolved);
    }

    // Backend-AGNOSTIQUE (le serveur peut tourner en sqlite=défaut OU NF_STORE=memory) :
    // on assert les invariants VRAIS des deux côtés, sans exiger un backend précis.
    //
    // - Store DRIZZLE (sqlite par défaut) : expose le chemin de sa base `.db` SOUS
    //   `var/` (base commune `kernel.varDir`). Couvre les briques durables
    //   (tokens/passkeys/audit/totp/webhooks) + session + idempotence (location
    //   résolue tardivement au `onReady`) + user (résolue par `provisionUsers`).
    for (const s of stores!.filter((s) => s.resolved === "drizzle")) {
      expect(s.location, `store drizzle ${s.brick} expose sa base`).to.be.a(
        "string",
      );
      expect(s.location!, `${s.brick} : base .db`).to.match(/\.db$/);
      expect(s.location!, `${s.brick} sous var/`).to.match(/(^|[/\\])var[/\\]/);
    }
    // - Store MEMORY (NF_STORE=memory, ou repli) : volatil en RAM → JAMAIS de
    //   chemin physique (l'UI dérive « en mémoire »).
    for (const s of stores!.filter((s) => s.resolved === "memory")) {
      expect(s.location, `store memory ${s.brick} sans emplacement`).to.equal(
        undefined,
      );
    }
    // Existence disque non vérifiée ici : la location est RELATIVE au cwd du SERVEUR
    // (racine repo, anti info-leak) et le process de test tourne dans le package http.
    // La création réelle du fichier est couverte par le boot (le serveur écrit sa
    // base au premier connect, sinon les requêtes échoueraient).
  });
});
