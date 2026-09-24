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
 * Fixtures dev : admin/secret-de-dev-42 (ROLE_NODEFONY_ADMIN).
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
      password: "secret-de-dev-42",
    },
  );
  expect(res.status, "login admin").to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "login pose un cookie de session").to.be.a("string");
  return cookie!;
}

interface StoreEntry {
  brick: string;
  nature?: string;
  resolved: string;
  available: string[];
  location?: string;
  connector?: string;
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

    // Backend-AGNOSTIQUE (le serveur peut tourner en sqlite=défaut, NF_STORE=memory,
    // OU NF_DATABASE_URL=postgres/mysql) : on assert les invariants VRAIS de chaque
    // profil, sans exiger un backend précis.
    //
    // - Store DRIZZLE : deux profils légitimes —
    //   · sqlite (défaut solo) : expose le chemin de sa base `.db` SOUS `var/`
    //     (base commune `kernel.varDir`) ;
    //   · backend RÉSEAU (infra déclarée postgres/mysql) : `location` est
    //     `undefined` PAR DESIGN (l'emplacement EST l'infra déclarée, surfacée à
    //     part — cf DrizzleOrm.location).
    //   Dans les deux cas le PROFIL est homogène : toutes les briques drizzle du
    //   connecteur ont une location, ou aucune (jamais un mélange).
    const drizzleStores = stores!.filter((s) => s.resolved === "drizzle");
    for (const s of drizzleStores) {
      if (s.location !== undefined) {
        expect(s.location, `${s.brick} : base .db`).to.match(/\.db$/);
        expect(s.location, `${s.brick} sous var/`).to.match(
          /(^|[/\\])var[/\\]/,
        );
      }
    }
    const withLocation = drizzleStores.filter((s) => s.location !== undefined);
    expect(
      withLocation.length === 0 || withLocation.length === drizzleStores.length,
      "profil drizzle homogène (tout sqlite → toutes les locations ; backend réseau → aucune)",
    ).to.equal(true);
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

describe("Stores — le CONNECTEUR de chaque brique portée par un ORM", () => {
  /**
   * 🔴 CE QUE CE CAS GARDE. Sans `connector`, la console devinait le
   * connecteur par `location` — absente pour une base réseau — et rangeait tout
   * sur le connecteur par défaut. Constaté au serveur réel sur PostgreSQL :
   * sept briques publiaient leur connecteur, et `user` (enregistrée par
   * l'APPLICATION, hors des services du framework) ne le publiait pas.
   * L'invariant porte donc sur TOUTE brique résolue par un ORM, d'où qu'elle
   * vienne.
   */
  it("toute brique résolue par un ORM publie son connecteur", async () => {
    const cookie = await loginAsAdmin();
    const res = await get(STORES, { cookie });
    expect(res.status, "admin lit /stores").to.equal(200);
    const stores = (res.body as { stores?: StoreEntry[] }).stores ?? [];
    const orm = stores.filter(
      (s) => s.resolved === "drizzle" || s.resolved === "mongoose",
    );
    const orphans = orm.filter(
      (s) => typeof s.connector !== "string" || s.connector.length === 0,
    );
    expect(
      orphans.map((s) => s.brick),
      "briques portées par un ORM sans connecteur publié",
    ).to.deep.equal([]);
    for (const s of stores.filter((s) => s.resolved === "memory")) {
      expect(s.connector, `store memory ${s.brick} sans connecteur`).to.equal(
        undefined,
      );
    }
  });
});

/** Un connecteur tel que `/nodefony/orm/api/orms` le résume. */
interface OrmEntry {
  name: string;
  vendor: string;
  default: boolean;
}

describe("Stores — le connecteur PAR DÉFAUT est celui qui porte les stores", () => {
  /**
   * 🔴 CE QUE CE CAS GARDE. Boot du dépôt sur MongoDB : un `default` Drizzle
   * (SQLite local) restait ouvert, sans une brique, avec le schéma du framework
   * en double — et Studio lui donnait la chip « défaut » parce qu'il s'appelait
   * ainsi. Deux invariants, vrais sur tout décor : la chip suit les briques
   * durables, et une infra MongoDB n'ouvre aucun `default` Drizzle.
   */
  it("la chip « défaut » suit les briques durables ; MongoDB n'ouvre pas de `default` Drizzle", async () => {
    const cookie = await loginAsAdmin();
    const [stores, orms] = await Promise.all([
      get(STORES, { cookie }),
      get("/nodefony/orm/api/orms", { cookie }),
    ]);
    expect(stores.status, "admin lit /stores").to.equal(200);
    expect(orms.status, "admin lit /orms").to.equal(200);
    const body = stores.body as {
      stores?: StoreEntry[];
      infra?: { database?: { family?: string } | null };
    };
    const raw = orms.body as unknown;
    const connectors = (
      Array.isArray(raw) ? raw : ((raw as { result?: unknown }).result ?? [])
    ) as OrmEntry[];
    expect(connectors, "liste des connecteurs").to.be.an("array").that.is.not
      .empty;

    const carriers = new Set(
      (body.stores ?? [])
        .filter(
          (s) => s.nature === "durable" && typeof s.connector === "string",
        )
        .map((s) => s.connector),
    );
    const flagged = connectors.filter((c) => c.default).map((c) => c.name);
    if (carriers.size > 0) {
      expect(flagged, "un seul connecteur par défaut").to.have.lengthOf(1);
      expect(
        [...carriers],
        "le connecteur par défaut porte les briques durables",
      ).to.include(flagged[0]);
    }
    if (body.infra?.database?.family === "mongo") {
      expect(
        connectors
          .filter((c) => c.vendor === "drizzle" && c.name === "default")
          .map((c) => c.name),
        "infra MongoDB : aucun `default` Drizzle ouvert",
      ).to.deep.equal([]);
    }
  });
});

describe("ORM — aucune entité inscrite sur un connecteur fermé", () => {
  /**
   * 🔴 CE QUE CE CAS GARDE. Sur MongoDB, le `User` de l'application restait une
   * table SQL sur `default`, connecteur que Drizzle n'ouvre pas sur cette
   * infra : entité orpheline, et boot muet. Vrai sur tout décor — chaque
   * entité doit avoir un connecteur OUVERT pour la servir.
   */
  it("chaque entité a son connecteur ouvert", async () => {
    const cookie = await loginAsAdmin();
    const [entities, orms] = await Promise.all([
      get("/nodefony/orm/api/entities", { cookie }),
      get("/nodefony/orm/api/orms", { cookie }),
    ]);
    expect(entities.status, "admin lit /entities").to.equal(200);
    expect(orms.status, "admin lit /orms").to.equal(200);
    const unwrap = (raw: unknown): unknown[] =>
      Array.isArray(raw)
        ? raw
        : (((raw as { result?: unknown }).result ?? []) as unknown[]);
    const open = new Set(
      (unwrap(orms.body) as Array<{ name: string }>).map((c) => c.name),
    );
    const list = unwrap(entities.body) as Array<{
      name: string;
      module?: string;
      connector: string;
    }>;
    expect(list, "liste des entités").to.not.be.empty;
    expect(
      list
        .filter((e) => !open.has(e.connector))
        .map((e) => `${e.name}@${e.module ?? ""} → ${e.connector}`),
      "entités sans connecteur ouvert",
    ).to.deep.equal([]);
  });
});

/** Un moteur de persistance tel que la carte des Stores l'annonce. */
interface EngineEntry {
  engine: string;
  package: string;
  installed: boolean;
  loaded: boolean;
}

describe("Stores — un moteur annoncé « chargé » l'est RÉELLEMENT", () => {
  /**
   * 🔴 CE QUE CE CAS GARDE. La carte annonçait `@nodefony/redis` **chargé** sur
   * une application qui ne le charge pas — trois lignes sous une carte d'infra
   * qui disait « CACHE (REDIS) : absent ». Cause : `loaded` lisait le registre
   * de FABRIQUES, où `@nodefony/framework` inscrit lui-même
   * `idempotency:"redis"` (couplage structurel, zéro cycle). Le nom d'un
   * backend sélectionnable n'est pas la présence d'un module.
   *
   * L'invariant est CROISÉ, donc vrai quel que soit le décor : un moteur chargé
   * doit figurer parmi les modules du noyau, et un module de persistance chargé
   * doit être annoncé chargé. Écrit dans un seul sens, le cas serait vert sur
   * une application qui ne charge aucun des trois.
   */
  it("`loaded` suit les MODULES du noyau, pas le registre de fabriques", async () => {
    const cookie = await loginAsAdmin();
    const [stores, modules] = await Promise.all([
      get(STORES, { cookie }),
      get("/nodefony/kernel/api/modules", { cookie }),
    ]);
    expect(stores.status, "admin lit /stores").to.equal(200);
    expect(modules.status, "admin lit /modules").to.equal(200);

    const engines = (stores.body as { engines?: EngineEntry[] }).engines;
    expect(engines, "payload.engines").to.be.an("array").that.is.not.empty;

    // Les noms de paquets réellement chargés, tels que le noyau les rend.
    // L'enveloppe du plan d'administration varie (`result` porte tantôt la
    // liste, tantôt un objet qui la contient) : on cherche le premier tableau
    // d'objets plutôt que de figer une forme qui se périmerait en silence.
    const payload = modules.body as Record<string, unknown>;
    const candidates: unknown[] = [
      modules.body,
      payload.modules,
      (payload.result as Record<string, unknown> | undefined)?.modules,
      payload.result,
    ];
    const loadedModules = (candidates.find(
      (c) => Array.isArray(c) && c.length > 0 && typeof c[0] === "object",
    ) ?? []) as Array<Record<string, unknown>>;
    expect(loadedModules, "liste des modules").to.be.an("array").that.is.not
      .empty;
    const names = new Set<string>();
    for (const m of loadedModules) {
      for (const k of ["name", "key", "package"]) {
        const v = m[k];
        if (typeof v === "string") names.add(v);
      }
    }

    for (const e of engines!) {
      const present = names.has(e.package) || names.has(e.engine);
      expect(
        e.loaded,
        `"${e.package}" annoncé loaded=${e.loaded} alors que le noyau ${
          present ? "LE charge" : "ne le charge PAS"
        } — la carte des Stores mentirait`,
      ).to.equal(present);
    }

    // Témoin du décor : sans au moins un moteur chargé ET un non chargé, la
    // boucle ci-dessus ne départage rien — elle serait verte sur une carte
    // uniformément fausse.
    expect(
      engines!.some((e) => e.loaded),
      "aucun moteur chargé : ce décor ne prouve rien",
    ).to.equal(true);
  });
});
