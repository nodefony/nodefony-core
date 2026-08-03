/// <reference types="node" />
/**
 * Integration — data plane admin (IAdminApi / AdminBroker) via HTTPS.
 *
 * P6 J3b : le data plane `/nodefony/<ns>/api` est désormais FERMÉ (aire
 * `nodefony-admin`, `authenticators: ["session"]`). Ce banc :
 *  - PROUVE la fermeture (anonyme → 401) — le trou comblé par J3b ;
 *  - vérifie la chaîne complète APRÈS login BFF (cookie de session) ;
 *  - couvre les régressions param `{name}` + enveloppe non double-wrappée.
 *
 * Requires: server on 5152 (HTTPS) + users `admin/secret` (module test).
 * Start: /start-server
 */
import { expect } from "chai";
import https from "node:https";

const HTTPS_BASE = {
  hostname: "localhost",
  port: 5152,
  rejectUnauthorized: false,
};

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const r = https.request(
      {
        ...HTTPS_BASE,
        method,
        path,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* keep raw */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// P6 J3b — cookie de session admin obtenu UNE fois (login BFF, route en bypass
// firewall). Toutes les requêtes data plane authentifiées le rejouent.
let cookie = "";
beforeAll(async () => {
  const res = await req(
    "POST",
    "/nodefony/security/api/auth/login",
    {},
    { username: "admin", password: "secret" },
  );
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  cookie = typeof first === "string" ? (first.split(";")[0] ?? "") : "";
  if (!cookie) {
    throw new Error(
      `login admin a échoué (status ${res.status}) — user admin/secret requis (module test)`,
    );
  }
});
/** Header d'auth = cookie de session BFF. */
const auth = (): Record<string, string> => ({ cookie });

// ── PONT FERMÉ : le data plane refuse l'anonyme (cœur de J3b) ─────────────────

describe("Admin data plane — FERMÉ à l'anonyme (P6 J3b)", () => {
  for (const path of [
    "/nodefony/kernel/api/health",
    "/nodefony/kernel/api/modules",
    "/nodefony/kernel/api/info",
    "/nodefony/http/api/servers",
    "/nodefony/framework/api/routes",
    "/nodefony/syslog/api/info",
  ]) {
    it(`GET ${path} SANS session → 401`, async () => {
      const r = await req("GET", path);
      expect(r.status).to.equal(401);
    });
  }

  it("le 401 vient du firewall (zone nodefony-admin), pas d'un 404 de route", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health");
    expect(r.status).to.equal(401);
    expect(JSON.stringify(r.body)).to.include("nodefony-admin");
  });

  it("login → data plane accessible (preuve que la fermeture est franchissable)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health", auth());
    expect(r.status).to.equal(200);
  });
});

// ── RBAC : un AUTHENTIFIÉ NON-ADMIN est REJETÉ (403) ──────────────────────────
// La zone firewall `nodefony-admin` n'exige que l'AUTHENTIFICATION (`["session"]`)
// → tout compte connecté ATTEINT le controller, qui doit trancher le RÔLE. Cette
// surface n'avait AUCUN test : le 403 était court-circuité pour un compte SANS
// rôle (`roles.length > 0 &&`, ex-fail-open). Logique pure verrouillée par
// `nodefony/tests/unit/adminRbac.test.ts` ; ici la preuve sur le WIRE réel.

/** Login BFF d'un compte arbitraire → cookie de session (vide si échec). */
async function loginCookie(
  username: string,
  password: string,
): Promise<string> {
  const res = await req(
    "POST",
    "/nodefony/security/api/auth/login",
    {},
    { username, password },
  );
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return typeof first === "string" ? (first.split(";")[0] ?? "") : "";
}

describe("Admin data plane — RBAC : authentifié NON-admin REJETÉ (403)", () => {
  // Un endpoint par producteur (rôle effectif = défaut broker ROLE_NODEFONY_ADMIN).
  const PROTECTED = [
    "/nodefony/kernel/api/info",
    "/nodefony/user/api/users",
    "/nodefony/http/api/sessions",
  ];

  it("compte `user` (ROLE_USER) franchit le firewall mais est refusé au RBAC", async () => {
    const userCookie = await loginCookie("user", "secret");
    expect(
      userCookie,
      "login user/secret doit réussir (fixture dev)",
    ).to.not.equal("");
    for (const path of PROTECTED) {
      const r = await req("GET", path, { cookie: userCookie });
      expect(r.status, `GET ${path} en ROLE_USER doit être 403`).to.equal(403);
      expect((r.body as Record<string, unknown>).required).to.equal(
        "ROLE_NODEFONY_ADMIN",
      );
    }
  });

  it("compte SANS rôle (roles=[]) REFUSÉ — preuve wire de l'ex-fail-open comblé", async () => {
    const probe = "norole-rbac-probe";
    // Création via l'API admin (roles non fourni → []). Idempotent (409 → relit l'id).
    let id: string | null = null;
    const created = await req("POST", "/nodefony/user/api/users", auth(), {
      identifier: probe,
      plainPassword: "secret-probe",
    });
    if (created.status === 201) {
      id = (created.body as { id: string }).id;
    } else if (created.status === 409) {
      const list = await req(
        "GET",
        `/nodefony/user/api/users?q=${probe}`,
        auth(),
      );
      const items =
        (list.body as { items?: Array<{ id: string; identifier: string }> })
          .items ?? [];
      id = items.find((u) => u.identifier === probe)?.id ?? null;
    }
    expect(id, "le compte sonde doit exister").to.be.a("string");
    try {
      const probeCookie = await loginCookie(probe, "secret-probe");
      expect(
        probeCookie,
        "login du compte sonde doit réussir (credentials valides, rôle indifférent)",
      ).to.not.equal("");
      // AVANT le fix : 200 (le fail-open laissait passer roles=[]). APRÈS : 403.
      const r = await req("GET", "/nodefony/user/api/users", {
        cookie: probeCookie,
      });
      expect(
        r.status,
        "un authentifié SANS rôle ne doit JAMAIS atteindre le data plane admin",
      ).to.equal(403);
    } finally {
      if (id) await req("DELETE", `/nodefony/user/api/users/${id}`, auth());
    }
  });
});

// ── kernel (authentifié) ─────────────────────────────────────────────────────

describe("Admin data plane — kernel", () => {
  it("GET /nodefony/kernel/api/health → 200 liveness", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health", auth());
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.status).to.be.a("string");
    expect(b.booted).to.equal(true);
    expect(b.uptime).to.be.a("number");
    expect(b.pid).to.be.a("number");
  });

  it("GET /nodefony/kernel/api/info → 200 runtime identity", async () => {
    const r = await req("GET", "/nodefony/kernel/api/info", auth());
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.version).to.be.a("string");
    expect(b.environment).to.be.a("string");
    expect(b.modules).to.be.a("number");
  });

  it("GET /nodefony/kernel/api/modules → 200 array of modules", async () => {
    const r = await req("GET", "/nodefony/kernel/api/modules", auth());
    expect(r.status).to.equal(200);
    expect(r.body).to.be.an("array");
    expect((r.body as Array<Record<string, unknown>>)[0].key).to.be.a("string");
  });

  // ── REGRESSION: regexp param {name} + extraction ──────────────────────────
  it("GET /nodefony/kernel/api/module/{name} → 200, param extrait", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/http", auth());
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.key).to.equal("http");
    expect(b.name).to.equal("@nodefony/http");
  });

  // ── REGRESSION: enveloppe non double-wrappée ──────────────────────────────
  it("module/{name} success n'est PAS double-wrappé (pas de .body imbriqué)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/framework", auth());
    expect(r.body).to.not.have.property("body");
  });

  it("GET module/{inexistant} → 404 enveloppe IAdminResponse", async () => {
    const r = await req("GET", "/nodefony/kernel/api/module/zzz-nope", auth());
    expect(r.status).to.equal(404);
    const b = r.body as Record<string, unknown>;
    expect(b.error).to.be.a("string");
    expect(b.key).to.equal("zzz-nope");
  });

  it("réponse admin porte le header x-nodefony-instance (per-instance)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/health", auth());
    expect(r.headers["x-nodefony-instance"]).to.be.a("string");
  });

  it("POST sur une route GET → 405 (RFC 9110 via Router, AVANT le firewall)", async () => {
    // Le Router résout (et détecte le method mismatch) dans handleFrontController,
    // AVANT handleSecurity → 405 prime sur 401, même sans session.
    const r = await req("POST", "/nodefony/kernel/api/health");
    expect(r.status).to.equal(405);
  });
});

// ── liveness/readiness PUBLIQUE graduée (zone nodefony-liveness) ──────────────
// /livez est le SEUL endpoint /nodefony/kernel/api/* atteignable SANS session :
// une zone dédiée plus spécifique (`["session","anonymous"]`) prime sur
// `nodefony-admin`. Anonyme (sonde k8s/Docker NON authentifiée) → minimum vital ;
// authentifié (cookie BFF) → détails runtime (pattern Actuator when-authorized).

describe("Admin data plane — liveness PUBLIQUE graduée (/livez)", () => {
  it("GET /livez SANS session → 200 (PAS 401) — sonde cloud-native", async () => {
    const r = await req("GET", "/nodefony/kernel/api/livez");
    expect(r.status).to.equal(200);
  });

  it("anonyme → minimum vital, SANS aucun détail runtime", async () => {
    const r = await req("GET", "/nodefony/kernel/api/livez");
    const b = r.body as Record<string, unknown>;
    expect(b.status).to.be.a("string");
    expect(b.booted).to.equal(true);
    expect(b.ready).to.equal(true);
    expect(b.uptime).to.be.a("number");
    expect(b.environment).to.be.a("string");
    // Fail-closed : aucune info détaillée ne fuite à l'anonyme.
    for (const leak of ["version", "node", "memory", "git", "modules", "pid"]) {
      expect(b, `anonyme ne doit PAS voir "${leak}"`).to.not.have.property(
        leak,
      );
    }
  });

  it("authentifié (session) → minimum vital + détails runtime", async () => {
    const r = await req("GET", "/nodefony/kernel/api/livez", auth());
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    expect(b.environment).to.be.a("string");
    expect(b.booted).to.equal(true);
    expect(b.version).to.be.a("string");
    expect(b.node).to.be.a("string");
    expect(b.modules).to.be.a("number");
    expect(b.memory).to.be.an("object");
    expect(b.git).to.be.an("object");
  });

  it("/livez seule est ouverte — /info reste 401 sans session", async () => {
    const open = await req("GET", "/nodefony/kernel/api/livez");
    const closed = await req("GET", "/nodefony/kernel/api/info");
    expect(open.status).to.equal(200);
    expect(closed.status).to.equal(401);
  });
});

// ── http ─────────────────────────────────────────────────────────────────────

describe("Admin data plane — http", () => {
  it("GET /nodefony/http/api/servers → liste serveurs + ports", async () => {
    const r = await req("GET", "/nodefony/http/api/servers", auth());
    expect(r.status).to.equal(200);
    const servers = r.body as Array<Record<string, unknown>>;
    expect(servers.some((s) => s.service === "server-http" && s.port === 5151))
      .to.be.true;
  });

  it("GET /nodefony/http/api/info → résumé serveurs prêts", async () => {
    const r = await req("GET", "/nodefony/http/api/info", auth());
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).serversReady).to.be.a("number");
  });

  it("GET /nodefony/http/api/sessions → état du sous-système (driver + storage + révocation)", async () => {
    const r = await req("GET", "/nodefony/http/api/sessions", auth());
    expect(r.status).to.equal(200);
    const b = r.body as Record<string, unknown>;
    // Contrat aligné sur `HttpAdminApi` (refonte 91403f01 : `deprecated` retiré,
    // remplacé par driver/storage/revocationHardened — « où on écrit »).
    expect(b.enabled).to.equal(true);
    expect(b.storage, "classe du store réel").to.be.a("string");
    expect(
      b.driver === null || typeof b.driver === "string",
      "driver = backend config (drizzle/files/redis/mongo) ou null",
    ).to.be.true;
    // Garde-fou anti-résurrection (révocation effective, fix 2026-06-21) : le store
    // actif DOIT être décoré → la révocation déconnecte vraiment.
    expect(
      b.revocationHardened,
      "store décoré (révocation effective)",
    ).to.equal(true);
    expect(b.active === null || typeof b.active === "number").to.be.true;
  });
});

// ── http : self-service « MES sessions » (public:true sous firewall + anti-IDOR) ─
// `sessions/mine` est `public: true` (broker sans contrainte de RÔLE) MAIS sous la
// zone `nodefony-admin` (auth `["session"]`) → anonyme 401, tout AUTHENTIFIÉ (même
// ROLE_USER) 200. Le périmètre = l'identité ALS serveur : un user ne voit/révoque
// QUE ses sessions. Preuve WIRE du modèle (la logique pure est dans
// http/tests/unit/SessionsAdmin.test.ts).

describe("Admin data plane — http self-service /sessions/mine", () => {
  it("anonyme → 401 (la zone firewall couvre AUSSI la route self-service)", async () => {
    const r = await req("GET", "/nodefony/http/api/sessions/mine");
    expect(r.status).to.equal(401);
  });

  it("ROLE_USER → 200 sur /sessions/mine MAIS 403 sur l'admin /sessions/list", async () => {
    const userCookie = await loginCookie("user", "secret");
    expect(userCookie, "login user/secret (fixture dev)").to.not.equal("");
    const mine = await req("GET", "/nodefony/http/api/sessions/mine", {
      cookie: userCookie,
    });
    expect(mine.status, "self-service ouvert à tout authentifié").to.equal(200);
    const list = await req("GET", "/nodefony/http/api/sessions/list", {
      cookie: userCookie,
    });
    expect(list.status, "énumération GLOBALE = admin only").to.equal(403);
  });

  it("ne renvoie QUE mes sessions + DTO redacté (jamais id/Attributes)", async () => {
    const userCookie = await loginCookie("user", "secret");
    const r = await req("GET", "/nodefony/http/api/sessions/mine", {
      cookie: userCookie,
    });
    expect(r.status).to.equal(200);
    const items = (r.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.length, "au moins la session courante").to.be.greaterThan(0);
    items.forEach((s) => {
      expect(s.user, "scope identité — jamais la session d'autrui").to.equal(
        "user",
      );
      expect(s, "pas d'id de session brut").to.not.have.property("id");
      expect(s, "pas d'Attributes (secrets)").to.not.have.property(
        "Attributes",
      );
      expect(s.ref as string, "ref HMAC public").to.match(/^sess_/);
    });
  });

  it("ANTI-IDOR : un ROLE_USER ne peut PAS révoquer la session d'AUTRUI via son ref", async () => {
    // ref RÉEL d'une session admin (énumération admin).
    const adminSessions = await req(
      "GET",
      "/nodefony/http/api/sessions/list?user=admin",
      auth(),
    );
    expect(adminSessions.status).to.equal(200);
    const adminItems = (adminSessions.body as { items: Array<{ ref: string }> })
      .items;
    expect(adminItems.length, "admin a ≥ 1 session").to.be.greaterThan(0);
    const adminRef = adminItems[0]!.ref;
    // user présente le ref d'admin (qui EXISTE) → hors de SON périmètre → 404
    // (pas 403 : la ressource est simplement introuvable dans son scope).
    const userCookie = await loginCookie("user", "secret");
    const attempt = await req(
      "POST",
      `/nodefony/http/api/sessions/mine/${adminRef}/revoke`,
      { cookie: userCookie },
    );
    expect(
      attempt.status,
      "ref d'autrui = introuvable dans mon scope",
    ).to.equal(404);
    // La session d'admin a SURVÉCU (l'IDOR est bien fermé).
    const after = await req(
      "GET",
      "/nodefony/http/api/sessions/list?user=admin",
      auth(),
    );
    const survived = (
      after.body as { items: Array<{ ref: string }> }
    ).items.some((s) => s.ref === adminRef);
    expect(survived, "la session d'admin n'a PAS été révoquée").to.equal(true);
  });

  it("je peux révoquer UNE de MES sessions par son ref (déconnexion d'appareil)", async () => {
    const userCookie = await loginCookie("user", "secret");
    const list = await req("GET", "/nodefony/http/api/sessions/mine", {
      cookie: userCookie,
    });
    const items = (list.body as { items: Array<{ ref: string }> }).items;
    expect(items.length).to.be.greaterThan(0);
    const myRef = items[0]!.ref;
    const revoke = await req(
      "POST",
      `/nodefony/http/api/sessions/mine/${myRef}/revoke`,
      { cookie: userCookie },
    );
    expect(revoke.status, "je révoque ma propre session").to.equal(200);
  });
});

// ── user : self-service « MON profil » (public:true, lecture redactée) ────────

describe("Admin data plane — user self-service /me (profil)", () => {
  it("anonyme → 401 (la zone firewall couvre la route self)", async () => {
    const r = await req("GET", "/nodefony/user/api/me");
    expect(r.status).to.equal(401);
  });

  it("ROLE_USER → 200, MON profil redacté (identifier = moi, jamais de hash)", async () => {
    const c = await loginCookie("user", "secret");
    expect(c, "login user/secret (fixture dev)").to.not.equal("");
    const r = await req("GET", "/nodefony/user/api/me", { cookie: c });
    expect(r.status).to.equal(200);
    const me = r.body as { identifier: string; roles: string[] };
    expect(me.identifier, "scope sur l'identité serveur").to.equal("user");
    expect(me.roles).to.be.an("array");
    // DTO redacté : ni champ password, ni hash bcrypt sérialisé
    expect(me).to.not.have.property("password");
    expect(JSON.stringify(me)).to.not.match(/\$2[aby]\$/);
  });
});

// ── user : self-service « changer MON mot de passe » (public:true + re-auth) ──
// `me/password` est `public: true` (broker sans contrainte de RÔLE) MAIS sous la
// zone `nodefony-admin` (auth `["session"]`) → anonyme 401, tout AUTHENTIFIÉ peut
// changer SON mot de passe. Re-auth du mot de passe ACTUEL obligatoire (403 sinon).
// Anti-IDOR : la cible est l'identité ALS serveur, jamais un param client. On opère
// sur un compte SONDE (jamais la fixture `user/secret`, partagée par les autres bancs).

describe("Admin data plane — user self-service /me/password", () => {
  const probe = "selfpw-probe";
  const pw0 = "probe-secret-0";
  let id: string | null = null;

  beforeAll(async () => {
    const created = await req("POST", "/nodefony/user/api/users", auth(), {
      identifier: probe,
      plainPassword: pw0,
      roles: ["ROLE_USER"],
    });
    if (created.status === 201) {
      id = (created.body as { id: string }).id;
    } else {
      const list = await req(
        "GET",
        `/nodefony/user/api/users?q=${probe}`,
        auth(),
      );
      const items =
        (list.body as { items?: Array<{ id: string; identifier: string }> })
          .items ?? [];
      id = items.find((u) => u.identifier === probe)?.id ?? null;
    }
    // État initial DÉTERMINISTE : le compte peut survivre à un run précédent
    // interrompu (mdp déjà tourné) → on le force à `pw0` via l'endpoint admin.
    if (id) {
      await req("POST", `/nodefony/user/api/users/${id}/password`, auth(), {
        plainPassword: pw0,
      });
    }
  });

  afterAll(async () => {
    if (id) await req("DELETE", `/nodefony/user/api/users/${id}`, auth());
  });

  it("anonyme → 401 (la zone firewall couvre AUSSI la route self-service)", async () => {
    const r = await req(
      "POST",
      "/nodefony/user/api/me/password",
      {},
      { currentPassword: pw0, newPassword: "whatever-123" },
    );
    expect(r.status).to.equal(401);
  });

  it("mauvais mot de passe actuel → 403 (re-auth), mdp inchangé", async () => {
    const c = await loginCookie(probe, pw0);
    expect(c, "login du compte sonde").to.not.equal("");
    const r = await req(
      "POST",
      "/nodefony/user/api/me/password",
      { cookie: c },
      { currentPassword: "WRONG-current", newPassword: "brand-new-456" },
    );
    expect(r.status).to.equal(403);
    // le mdp n'a PAS changé : pw0 authentifie toujours
    expect(await loginCookie(probe, pw0), "mdp préservé").to.not.equal("");
  });

  it("bon mot de passe actuel → 200 ; le nouveau mdp marche, l'ancien non", async () => {
    const c = await loginCookie(probe, pw0);
    const pw1 = "rotated-secret-1";
    const r = await req(
      "POST",
      "/nodefony/user/api/me/password",
      { cookie: c },
      { currentPassword: pw0, newPassword: pw1 },
    );
    expect(r.status, "changement self-service accepté").to.equal(200);
    // le NOUVEAU mot de passe authentifie ; l'ANCIEN ne marche plus
    expect(await loginCookie(probe, pw1), "nouveau mdp valide").to.not.equal(
      "",
    );
    expect(await loginCookie(probe, pw0), "ancien mdp révoqué").to.equal("");
  });
});

// ── user admin : PATCH parse bien le CORPS (régression — PATCH était absent de
// la table `parse` du Request → body vide → patch {} → UPDATE vide = 500). Preuve
// wire que `request.body` est parsé sur PATCH (pas seulement POST/PUT).

describe("Admin data plane — user PATCH (corps parsé)", () => {
  const probe = "patch-body-probe";
  let id: string | null = null;

  beforeAll(async () => {
    const created = await req("POST", "/nodefony/user/api/users", auth(), {
      identifier: probe,
      plainPassword: "secret-probe",
      roles: ["ROLE_USER", "ROLE_NODEFONY_ADMIN"],
    });
    if (created.status === 201) {
      id = (created.body as { id: string }).id;
    } else {
      const list = await req(
        "GET",
        `/nodefony/user/api/users?q=${probe}`,
        auth(),
      );
      id =
        (
          (list.body as { items?: Array<{ id: string; identifier: string }> })
            .items ?? []
        ).find((u) => u.identifier === probe)?.id ?? null;
    }
  });

  afterAll(async () => {
    if (id) await req("DELETE", `/nodefony/user/api/users/${id}`, auth());
  });

  it("PATCH {roles} applique les rôles (corps parsé, ≠ 500/400)", async () => {
    expect(id, "compte sonde créé").to.be.a("string");
    // retire ADMIN → un autre admin existe (admin/secret) → pas le dernier → 200
    const patch = await req("PATCH", `/nodefony/user/api/users/${id}`, auth(), {
      roles: ["ROLE_USER"],
    });
    expect(patch.status, "PATCH accepté (corps bien parsé)").to.equal(200);
    expect((patch.body as { roles: string[] }).roles).to.deep.equal([
      "ROLE_USER",
    ]);
    // re-lecture : la mutation a persisté
    const after = await req("GET", `/nodefony/user/api/users/${id}`, auth());
    expect((after.body as { roles: string[] }).roles).to.deep.equal([
      "ROLE_USER",
    ]);
  });

  it("PATCH {} (corps vide) → 400, jamais 500 (garde anti-UPDATE-vide)", async () => {
    const r = await req("PATCH", `/nodefony/user/api/users/${id}`, auth(), {});
    expect(r.status).to.equal(400);
  });
});

// ── framework ──────────────────────────────────────────────────────────────

describe("Admin data plane — framework", () => {
  it("GET /nodefony/framework/api/routes → dump contient les routes admin", async () => {
    const r = await req("GET", "/nodefony/framework/api/routes", auth());
    expect(r.status).to.equal(200);
    const routes = r.body as Array<Record<string, unknown>>;
    expect(routes.some((x) => x.path === "/nodefony/kernel/api/health")).to.be
      .true;
  });

  it("GET /nodefony/framework/api/info → routesTotal > 0", async () => {
    const r = await req("GET", "/nodefony/framework/api/info", auth());
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).routesTotal).to.be.a("number");
  });

  it("GET /nodefony/framework/api/admin → catalogue des 4 producteurs", async () => {
    const r = await req("GET", "/nodefony/framework/api/admin", auth());
    expect(r.status).to.equal(200);
    const producers = (r.body as { producers: Array<Record<string, unknown>> })
      .producers;
    const namespaces = producers.map((p) => p.namespace);
    expect(namespaces).to.include.members([
      "kernel",
      "http",
      "framework",
      "syslog",
    ]);
    const kernel = producers.find((p) => p.namespace === "kernel")!;
    expect(kernel.label).to.equal("Kernel");
    expect(kernel.endpoints).to.be.an("array");
    const eps = kernel.endpoints as Array<Record<string, unknown>>;
    expect(eps.some((e) => e.path === "/nodefony/kernel/api/health")).to.be
      .true;
    const orders = producers.map((p) => p.order as number);
    expect(orders).to.deep.equal([...orders].sort((a, b) => a - b));
  });
});

// ── syslog ───────────────────────────────────────────────────────────────────

describe("Admin data plane — syslog", () => {
  it("GET /nodefony/syslog/api/info → compteurs", async () => {
    const r = await req("GET", "/nodefony/syslog/api/info", auth());
    expect(r.status).to.equal(200);
    expect((r.body as Record<string, unknown>).valid).to.be.a("number");
  });

  it("GET /nodefony/syslog/api/logs?limit=3 → ≤ 3 entrées", async () => {
    const r = await req("GET", "/nodefony/syslog/api/logs?limit=3", auth());
    expect(r.status).to.equal(200);
    expect(r.body).to.be.an("array");
    expect((r.body as unknown[]).length).to.be.at.most(3);
  });
});

// ── SPA fallback ne masque PAS les vraies routes /nodefony/* (régression) ──────
// La coquille SPA `/nodefony/<page>` reste PUBLIQUE (hors aire data plane : pas
// de `/api`) — on protège les DONNÉES, pas la page (l'AuthGuard front redirige).
// Le fallback deep-link doit utiliser un préfixe LITTÉRAL (`/modules/{name}`),
// pas un générique `/{section}/{page}` : sinon il masque les routes des autres
// modules sous `/nodefony/<x>/<y>`. Régression 2026-05-20 (21 échecs http).

describe("Admin data plane — SPA fallback vs vraies routes (non-shadow)", () => {
  it("GET /nodefony/modules/core → 200 HTML (coquille SPA publique, fallback littéral)", async () => {
    const r = await req("GET", "/nodefony/modules/core");
    expect(r.status).to.equal(200);
    expect(r.body, "le SPA renvoie du HTML brut, pas du JSON").to.be.a(
      "string",
    );
    // Casse libre : la coquille vient de Vite en dev (`<!doctype html>`) et du
    // build publish en static (`<!DOCTYPE html>`) — le doctype est insensible à la casse.
    expect((r.body as string).toUpperCase()).to.include("<!DOCTYPE");
  });

  it("GET /nodefony/kernel/api/info (authentifié) → 200 JSON (route ≥3 seg NON masquée)", async () => {
    const r = await req("GET", "/nodefony/kernel/api/info", auth());
    expect(r.status).to.equal(200);
    expect(r.body, "la route data plane gagne → JSON").to.be.an("object");
    expect((r.body as Record<string, unknown>).version).to.be.a("string");
  });

  it("GET /nodefony/test/index → JSON (route 2-seg d'un AUTRE module, hors aire, NON masquée)", async () => {
    const r = await req("GET", "/nodefony/test/index");
    expect(r.status).to.equal(200);
    expect(r.body, "le module test gagne → JSON, pas le HTML du SPA").to.be.an(
      "object",
    );
  });
});

// ── mode de pagination invalide → 400 (mapping PaginationModeError au data plane) ─
// Preuve WIRE du maillon `assertPageQuery` (store) → `AdminApiController.runAdmin`
// (mapping 4xx) → HTTP. Le contrat IPage pose offset/cursor mutuellement exclusifs ;
// un store qui reçoit le mauvais mode lève `PaginationModeError` (code 400), et le
// data plane doit la restituer telle quelle — PAS la maquiller en 500 générique.
// L'endpoint apikeys est le SEUL qui parse `cursor` ET l'envoie à un store OFFSET
// (token store memory/drizzle en dev) → la garde mord. Avant ce commit : silence
// (cursor avalé, page 1 en boucle). Après : 400 explicite.

describe("Admin data plane — mode de pagination invalide → 400", () => {
  it("GET /nodefony/security/api/apikeys?cursor=zzz (store token offset) → 400, jamais 500", async () => {
    const r = await req(
      "GET",
      "/nodefony/security/api/apikeys?cursor=zzz",
      auth(),
    );
    expect(
      r.status,
      "un curseur envoyé à un store offset = faute CLIENT (400), pas une panne serveur (500)",
    ).to.equal(400);
    expect(
      JSON.stringify(r.body),
      "le message de PaginationModeError doit remonter au client",
    ).to.match(/pagination mode/i);
  });

  it("le MÊME endpoint sans cursor → 200 (la garde ne mord QUE le mauvais mode)", async () => {
    const r = await req(
      "GET",
      "/nodefony/security/api/apikeys?limit=5",
      auth(),
    );
    expect(r.status, "cas nominal offset intact").to.equal(200);
  });
});

// ── CONTRAT DE PAGE sur le wire — `routes/page` parle IPageQuery ──────────────
// Cet endpoint portait le SECOND dialecte de pagination du dépôt
// (`page`/`pageSize`/`sort`/`dir`, réponse `{rows,total}`) et n'avait AUCUN
// test. Il consomme désormais `parsePageQuery` et rend un `IPage`, comme tout
// le reste. Ce banc verrouille les deux bouts de la traduction.

describe("Admin data plane — routes/page parle le contrat IPageQuery", () => {
  it("rend un IPage (items/limit/offset/hasNext), plus `rows`", async () => {
    const r = await req(
      "GET",
      "/nodefony/framework/api/routes/page?limit=5",
      auth(),
    );
    expect(r.status).to.equal(200);
    const page = r.body as {
      items?: unknown[];
      rows?: unknown[];
      total?: number;
      limit?: number;
      offset?: number;
      hasNext?: boolean;
    };
    expect(page.items, "le contrat nomme la collection `items`").to.be.an(
      "array",
    );
    expect(
      page.rows,
      "`rows` était le dialecte — il ne doit plus exister",
    ).to.equal(undefined);
    expect(page.items!.length).to.be.at.most(5);
    expect(page.limit).to.equal(5);
    expect(page.offset).to.equal(0);
    expect(page.hasNext, "le dépôt a plus de 5 routes").to.equal(true);
    expect(page.total).to.be.a("number");
  });

  it("`offset` décale la fenêtre (deux pages disjointes)", async () => {
    const first = (
      await req("GET", "/nodefony/framework/api/routes/page?limit=3", auth())
    ).body as { items: { name: string }[] };
    const second = (
      await req(
        "GET",
        "/nodefony/framework/api/routes/page?limit=3&offset=3",
        auth(),
      )
    ).body as { items: { name: string }[] };
    const firstNames = first.items.map((r) => r.name);
    for (const row of second.items) {
      expect(firstNames, "page 2 ne rejoue pas la page 1").to.not.include(
        row.name,
      );
    }
  });

  it("`order=path:DESC` trie — et l'inverse de `path:ASC`", async () => {
    const asc = (
      await req(
        "GET",
        "/nodefony/framework/api/routes/page?limit=10&order=path:ASC",
        auth(),
      )
    ).body as { items: { path: string | null }[] };
    const desc = (
      await req(
        "GET",
        "/nodefony/framework/api/routes/page?limit=10&order=path:DESC",
        auth(),
      )
    ).body as { items: { path: string | null }[] };
    expect(asc.items[0]?.path).to.not.equal(desc.items[0]?.path);
    const paths = asc.items.map((r) => r.path ?? "");
    expect(paths, "ASC = ordre lexicographique croissant").to.deep.equal(
      [...paths].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("un champ de tri HORS allowlist → 400, jamais un tri silencieusement inerte", async () => {
    const r = await req(
      "GET",
      "/nodefony/framework/api/routes/page?order=secretColumn:ASC",
      auth(),
    );
    expect(r.status).to.equal(400);
    expect(JSON.stringify(r.body)).to.match(/sortable|secretColumn/i);
  });

  it("`limit` au-delà du cap est ramené, jamais refusé", async () => {
    const r = await req(
      "GET",
      "/nodefony/framework/api/routes/page?limit=99999",
      auth(),
    );
    expect(r.status).to.equal(200);
    expect((r.body as { limit: number }).limit).to.equal(200);
  });

  it("`q` filtre, et `total` reflète le filtre (pas le dump entier)", async () => {
    const all = (
      await req("GET", "/nodefony/framework/api/routes/page?limit=1", auth())
    ).body as { total: number };
    const filtered = (
      await req(
        "GET",
        "/nodefony/framework/api/routes/page?limit=100&q=nodefony",
        auth(),
      )
    ).body as { total: number; items: { path: string | null }[] };
    expect(filtered.total).to.be.below(all.total);
    expect(filtered.items.length).to.be.above(0);
  });
});

// ── Filtre MULTI-SÉLECTION (opérateur `in`) sur routes/page ───────────────────
// La colonne « Méthodes » est multi-valeur (`GET,POST`) : « est l'un de » doit
// matcher par INTERSECTION, pas par égalité de chaîne. Le miroir client de cette
// règle vit dans `matchFilter` (DataGrid) — les deux doivent filtrer pareil.

describe("Admin data plane — routes/page filtre `in` (multi-sélection)", () => {
  /** Construit l'URL d'un filtre colonne tel que le DataGrid le sérialise. */
  const withFilter = (key: string, op: string, value: string) =>
    `/nodefony/framework/api/routes/page?limit=200&filters=${encodeURIComponent(
      JSON.stringify([{ key, op, value }]),
    )}`;

  it("`in` avec une seule méthode ne rend que des routes qui la portent", async () => {
    const r = await req("GET", withFilter("methods", "in", "POST"), auth());
    expect(r.status).to.equal(200);
    const { items } = r.body as { items: { methods: string[] }[] };
    expect(items.length, "le dépôt expose des routes POST").to.be.above(0);
    for (const row of items) {
      expect(row.methods).to.include("POST");
    }
  });

  it("`in` avec deux méthodes rend l'UNION (jamais l'intersection)", async () => {
    const only = (m: string) =>
      req("GET", withFilter("methods", "in", m), auth()).then(
        (r) => (r.body as { total: number }).total,
      );
    const [get, post, both] = await Promise.all([
      only("GET"),
      only("POST"),
      req("GET", withFilter("methods", "in", "GET,POST"), auth()).then(
        (r) => (r.body as { total: number }).total,
      ),
    ]);
    expect(both).to.be.at.least(Math.max(get, post));
    expect(
      both,
      "union ≤ somme (une route peut porter les deux)",
    ).to.be.at.most(get + post);
  });

  it("une route MULTI-méthode matche via UNE seule des valeurs choisies", async () => {
    const all = await req(
      "GET",
      "/nodefony/framework/api/routes/page?limit=200",
      auth(),
    );
    const multi = (all.body as { items: { methods: string[] }[] }).items.find(
      (r) => r.methods.length > 1,
    );
    if (!multi) return; // aucune route multi-méthode montée : rien à prouver
    const one = multi.methods[0]!;
    const r = await req("GET", withFilter("methods", "in", one), auth());
    const names = (r.body as { items: { methods: string[] }[] }).items;
    expect(
      names.some((x) => x.methods.join(",") === multi.methods.join(",")),
      `une route ${multi.methods.join(",")} doit sortir sur ?in=${one}`,
    ).to.equal(true);
  });

  it("`in` vide ne filtre RIEN (pas de page vide sur un filtre non renseigné)", async () => {
    const total = (
      await req("GET", "/nodefony/framework/api/routes/page?limit=1", auth())
    ).body as { total: number };
    const r = await req("GET", withFilter("methods", "in", ""), auth());
    expect((r.body as { total: number }).total).to.equal(total.total);
  });
});

// ── TRI des UTILISATEURS : la capacité déclarée par le backend fait foi ───────
// Le tri était déjà implémenté par les trois repositories, mais le data plane ne
// le laissait pas passer. Ce banc prouve la chaîne `?order=` → repository, et le
// refus explicite d'un champ hors capacité.

describe("Admin data plane — le tri des utilisateurs traverse", () => {
  const USERS = "/nodefony/user/api/users";

  it("`identifier` ASC et DESC rendent des ordres exactement inverses", async () => {
    const asc = (
      await req("GET", `${USERS}?limit=50&order=identifier:ASC`, auth())
    ).body as { items: { identifier: string }[] };
    const desc = (
      await req("GET", `${USERS}?limit=50&order=identifier:DESC`, auth())
    ).body as { items: { identifier: string }[] };
    expect(asc.items.length).to.be.above(1);
    expect(asc.items.map((u) => u.identifier)).to.deep.equal(
      [...desc.items.map((u) => u.identifier)].reverse(),
    );
  });

  it("le tri par défaut reste `identifier` ASC (sans `order`)", async () => {
    const page = (await req("GET", `${USERS}?limit=50`, auth())).body as {
      items: { identifier: string }[];
    };
    const ids = page.items.map((u) => u.identifier);
    expect(ids).to.deep.equal([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("un champ HORS capacité est refusé (400) et la réponse NOMME les champs valides", async () => {
    const r = await req("GET", `${USERS}?order=password:ASC`, auth());
    expect(r.status, "jamais un tri silencieux sur un champ interdit").to.equal(
      400,
    );
    const body = JSON.stringify(r.body);
    expect(body).to.match(/password/);
    // Un refus utile dit ce qui EST permis — sinon l'appelant devine.
    expect(body).to.match(/identifier/);
  });

  it("le tri s'applique AVANT la pagination (page 2 prolonge page 1)", async () => {
    const p1 = (
      await req("GET", `${USERS}?limit=2&offset=0&order=identifier:ASC`, auth())
    ).body as { items: { identifier: string }[]; total: number };
    if (p1.total < 3) return; // trop peu de comptes pour deux pages
    const p2 = (
      await req("GET", `${USERS}?limit=2&offset=2&order=identifier:ASC`, auth())
    ).body as { items: { identifier: string }[] };
    const seq = [...p1.items, ...p2.items].map((u) => u.identifier);
    expect(seq).to.deep.equal([...seq].sort((a, b) => a.localeCompare(b)));
  });
});
