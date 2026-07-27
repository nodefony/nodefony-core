/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * P6 J1 — zone protégée `test-secure` (firewall + UserPasswordAuthenticator).
 *
 * Banc : module test `nodefony/secure/` (routes `/nodefony/test/secure/*`,
 * comptes admin/secret + user/secret en annuaire in-memory). Gates :
 * - Zero Trust : aucune preuve → 401 + `WWW-Authenticate` (RFC 7235) ;
 * - credential invalide → 401 au message UNIFORME (anti-énumération) ;
 * - credential valide → 200, identité propagée dans l'ALS (`/whoami`) ;
 * - hors zone : le reste du module test reste public.
 */

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { ...BASE, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({
              status: res.statusCode!,
              headers: res.headers as Record<string, unknown>,
              body: JSON.parse(raw),
            });
          } catch {
            resolve({
              status: res.statusCode!,
              headers: res.headers as Record<string, unknown>,
              body: raw,
            });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const basic = (identifier: string, password: string) => ({
  authorization: `Basic ${Buffer.from(`${identifier}:${password}`, "utf8").toString("base64")}`,
});

/**
 * `true` si le serveur de banc tourne AVEC le backoff de connexion.
 *
 * Le décor par défaut le DÉSACTIVE (cf le lanceur et la tâche d'intégration) : le
 * throttle compte par identifiant saisi et vit aussi longtemps que le serveur, or
 * toute la suite s'authentifie avec le même compte de banc — trois échecs n'importe
 * où, y compris dans un banc d'attaque qui fait son travail, condamnent tous les
 * fichiers suivants. Les cas qui éprouvent le CÂBLAGE du 429 se réactivent en
 * relançant le serveur avec `NF__SECURITY__RATELIMIT__ENABLED=true`. Le backoff
 * lui-même est prouvé unitairement (`security/tests/unit/loginThrottler`, 10 cas) —
 * ce qui se joue ici est ce qu'un banc unitaire ne peut pas dire : que le firewall
 * traduit l'erreur en `429 + Retry-After`, et que les deux portes partagent bien le
 * compteur.
 */
const throttleOn = process.env.NF__SECURITY__RATELIMIT__ENABLED === "true";

/**
 * Efface la dette de backoff accumulée sur un compte RÉEL, par le seul moyen que la
 * doctrine prévoit : une authentification RÉUSSIE (`LoginThrottler.recordSuccess`
 * oublie l'identifiant — NIST : l'utilisateur légitime ne traîne pas la dette d'un
 * attaquant passé).
 *
 * Pourquoi c'est nécessaire ici. Le throttle compte par identifiant SAISI, dans un
 * serveur qui vit toute la suite. Les cas ci-dessous ont besoin d'un compte qui
 * EXISTE (« mot de passe invalide → 401 » ne veut rien dire sur un inconnu), donc
 * l'astuce de l'identifiant unique par run ne s'applique pas à eux : ils dépensent
 * du crédit sur `admin`. Trois échecs suffisent à épuiser `freeAttempts`, et le
 * suivant arme un délai qui DOUBLE — après quoi tout ce qui s'authentifie en `admin`
 * reçoit 429, y compris avec le bon mot de passe, dans ce fichier comme dans les
 * suivants. Le banc s'appuyait jusqu'ici sur un hasard : en développement supervisé,
 * un rebuild redémarrait le serveur et remettait les compteurs à zéro.
 *
 * Tolérant par construction : un nettoyage ne doit jamais masquer l'échec qu'il suit.
 */
async function forgetThrottle(identifier: string): Promise<void> {
  try {
    await get("/nodefony/test/secure/ping", basic(identifier, "secret"));
  } catch {
    /* le test qui suit dira ce qui ne va pas — pas ce nettoyage */
  }
}

describe("Firewall — zone protégée test-secure (requires server)", () => {
  // Chaque cas rend le compte `admin` au suivant sans dette de backoff. Posé en
  // `afterEach` et non en fin de corps : un cas qui échoue ne doit pas empoisonner
  // tous ceux d'après (c'est exactement ce qui a produit 60 rouges pour un défaut).
  afterEach(async () => {
    await forgetThrottle("admin");
  });
  it("Zero Trust : aucune preuve → 401 + WWW-Authenticate Basic (RFC 7235)", async () => {
    const { status, headers } = await get("/nodefony/test/secure/ping");
    expect(status).to.equal(401);
    expect(headers["www-authenticate"]).to.be.a("string");
    expect(headers["www-authenticate"]).to.match(/^Basic /);
  });

  it("mot de passe invalide → 401", async () => {
    const { status } = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "wrong"),
    );
    expect(status).to.equal(401);
  });

  it("anti-énumération : identifiant inconnu et mauvais mot de passe = même réponse", async () => {
    // Identifiant inconnu UNIQUE par run : le throttler (J2) compte par
    // identifiant saisi et le serveur survit aux runs — un "ghost" fixe
    // accumulerait ses échecs d'un run à l'autre jusqu'au 429.
    const unknownUser = await get(
      "/nodefony/test/secure/ping",
      basic(`ghost-${Date.now()}`, "whatever"),
    );
    const badPassword = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "wrong"),
    );
    expect(unknownUser.status).to.equal(401);
    expect(badPassword.status).to.equal(401);
    // Même message d'erreur côté client (la raison fine reste en audit serveur).
    const messageOf = (body: unknown) =>
      typeof body === "object" && body !== null
        ? (body as { message?: string }).message
        : body;
    expect(messageOf(unknownUser.body)).to.deep.equal(
      messageOf(badPassword.body),
    );
  });

  it("enveloppe Basic malformée → 401 (jamais 500)", async () => {
    const { status } = await get("/nodefony/test/secure/ping", {
      authorization: "Basic !!!not-base64!!!",
    });
    expect(status).to.equal(401);
  });

  it("credential incomplet (mot de passe vide / identifiant vide) → 401 (jamais 200/500)", async () => {
    // `admin:` (mot de passe vide) : un compte ne s'authentifie JAMAIS sur un
    // credential incomplet, même si l'identifiant existe — rejet avant le hash.
    const emptyPassword = await get(
      "/nodefony/test/secure/ping",
      basic("admin", ""),
    );
    expect(emptyPassword.status).to.equal(401);
    // `:secret` (identifiant vide) → 401 uniforme également.
    const emptyIdentifier = await get(
      "/nodefony/test/secure/ping",
      basic("", "secret"),
    );
    expect(emptyIdentifier.status).to.equal(401);
  });

  it("credential valide → 200 (zone franchie)", async () => {
    const { status, body } = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "secret"),
    );
    expect(status).to.equal(200);
    expect(body).to.deep.equal({ pong: true, secure: true });
  });

  it("identité propagée dans l'ALS : /whoami rend l'utilisateur du firewall", async () => {
    const { status, body } = await get(
      "/nodefony/test/secure/whoami",
      basic("admin", "secret"),
    );
    expect(status).to.equal(200);
    expect((body as { identifier: string }).identifier).to.equal("admin");
    expect((body as { roles: string[] }).roles).to.include("ROLE_ADMIN");
  });

  it("second compte du banc : user/secret → ROLE_USER", async () => {
    const { body } = await get(
      "/nodefony/test/secure/whoami",
      basic("user", "secret"),
    );
    expect((body as { identifier: string }).identifier).to.equal("user");
    expect((body as { roles: string[] }).roles).to.include("ROLE_USER");
  });

  it("hors zone : le reste du module test reste public (aucune régression)", async () => {
    const { status } = await get("/nodefony/test/index");
    expect(status).to.equal(200);
  });

  it("scheme case-insensitive (RFC 7235) : `basic` minuscule accepté", async () => {
    const header = basic("admin", "secret").authorization.replace(
      "Basic",
      "basic",
    );
    const { status } = await get("/nodefony/test/secure/ping", {
      authorization: header,
    });
    expect(status).to.equal(200);
  });
});

describe("P6 J2 — Argon2id + throttling NIST (requires server)", () => {
  it("migration transparente : après login, le hash stocké est au format argon2id", async () => {
    // Les comptes du banc naissent en bcrypt (in-memory) ; le login réussi
    // ci-dessus ou celui-ci déclenche le re-hash MigratingEncoder → argon2id.
    await get("/nodefony/test/secure/ping", basic("user", "secret"));
    const { status, body } = await get(
      "/nodefony/test/secure/encoder",
      basic("user", "secret"),
    );
    expect(status).to.equal(200);
    expect((body as { format: string }).format).to.equal("argon2id");
  });

  // Décor OPT-IN : relancer le serveur avec `NF__SECURITY__RATELIMIT__ENABLED=true`.
  // Sans lui, ce cas ne prouverait rien (aucun 429 ne peut sortir).
  it.skipIf(!throttleOn)(
    "backoff NIST : échecs répétés → 429 + Retry-After (sans WWW-Authenticate)",
    async () => {
      // Identifiant unique par run (compteur côté serveur) — inconnu en base :
      // le throttle s'applique à l'identifiant SAISI (zéro oracle d'énumération).
      const target = `bruteforce-${Date.now()}`;
      // freeAttempts=3 (défaut) : 3 échecs libres + le 4e arme le délai (1 s).
      for (let i = 0; i < 4; i++) {
        const { status } = await get(
          "/nodefony/test/secure/ping",
          basic(target, "bad"),
        );
        expect(status).to.equal(401);
      }
      const blocked = await get(
        "/nodefony/test/secure/ping",
        basic(target, "bad"),
      );
      expect(blocked.status).to.equal(429);
      expect(Number(blocked.headers["retry-after"])).to.be.greaterThan(0);
      expect(blocked.headers["www-authenticate"]).to.equal(undefined);
      // Le délai EXPIRE (jamais de lockout dur) : on retombe sur 401 classique.
      await new Promise((r) => setTimeout(r, 1200));
      const after = await get(
        "/nodefony/test/secure/ping",
        basic(target, "bad"),
      );
      expect(after.status).to.equal(401);
    },
  );

  it("le throttle d'un identifiant martelé ne bloque pas les autres comptes", async () => {
    const { status } = await get(
      "/nodefony/test/secure/whoami",
      basic("admin", "secret"),
    );
    expect(status).to.equal(200);
  });
});
