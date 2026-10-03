import assert from "node:assert/strict";
import {
  UserService,
  InMemoryUserRepository,
  IdentifierTakenError,
  type IPasswordEncoder,
  type IOAuthProfile,
} from "../../index";

/**
 * Matrice d'ATTAQUE (red-team) OAuth2 social — niveau PROVISIONING (Shadow User).
 * Dérivée de la MENACE (OWASP « Account Takeover » via OAuth, décision Nodefony
 * `project_oauth2_social_identity` : 0 liaison-email auto), PAS de l'implémentation.
 *
 * Complète `oauthProvisioner.test.ts` (matrice fonctionnelle, repo STUBÉ fonction
 * par fonction) en attaquant la CHAÎNE RÉELLE : `UserService.provisionOAuthUser`
 * + le **vrai** `InMemoryUserRepository` (jamais de stub de la logique testée),
 * comme l'exige le gabarit red-team. Vecteurs adverses :
 *
 *   A1 — Account-takeover + ESCALADE : un fournisseur OAuth (ou un fournisseur
 *        légitime mal configuré / sous contrôle de l'attaquant) renvoie l'email
 *        d'un compte LOCAL privilégié (ROLE_ADMIN, mot de passe). Le provisioning
 *        NE DOIT PAS lier ce compte, ni en créer un second sous le même
 *        identifiant (la session recharge par identifiant : ce doublon SERAIT
 *        l'admin) → refus explicite, compte admin INTACT.
 *   A2 — Anti-élévation par re-login : OAuth = authentification, pas autorisation.
 *        Un 2ᵉ login (même compte externe) avec une policy `defaultRoles` élevée ne
 *        doit JAMAIS réécrire les rôles du Shadow User existant (la base locale
 *        reste la source de vérité des droits).
 *   A3 — Confusion cross-provider : un `providerId` identique sur deux fournisseurs
 *        (`google:777` vs `github:777`) doit donner DEUX comptes distincts — le lien
 *        est la PAIRE (provider, providerId), jamais le providerId seul (sinon un
 *        attaquant GitHub avec un id == un `sub` Google prendrait le compte Google).
 */

// Encodeur stub — le provisioning ne touche JAMAIS au credential local (prouvé en
// l'isolant : aucune des assertions ne dépend du hash).
const encoder: IPasswordEncoder = {
  supports: (hash) => hash.startsWith("hashed:"),
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: () => Promise.resolve(true),
  needsRehash: () => false,
};

const ADMIN_EMAIL = "victim-admin@corp.example";

/** Repo réel seedé d'une victime : compte LOCAL admin avec mot de passe, 0 lien social. */
function seedWithAdminVictim(): InMemoryUserRepository {
  return new InMemoryUserRepository([
    {
      id: "00000000-0000-4000-8000-victimadmin01",
      identifier: ADMIN_EMAIL,
      roles: ["ROLE_ADMIN", "ROLE_USER"],
      password: "pre-hashed-admin-secret",
    },
  ]);
}

const profileColliding: IOAuthProfile = {
  provider: "google",
  providerId: "g-attacker-108",
  email: ADMIN_EMAIL, // ← collision VOLONTAIRE avec l'email de l'admin local
  emailVerified: true,
  name: "Attacker via Google",
  raw: {},
};

const USER_ONLY = { defaultRoles: ["ROLE_USER"], allowSignup: true };

describe("OAuth2 — red-team PROVISIONING (Shadow User, vrai InMemoryUserRepository)", () => {
  // A1 — account-takeover + escalade de privilège via collision d'email.
  //
  // La session s'ouvre PAR IDENTIFIANT (`establishSessionFor`) et chaque requête
  // suivante recharge le compte par identifiant : un Shadow User créé sous
  // l'email d'un compte existant serait donc, dès la requête suivante, l'ADMIN
  // — le premier compte trouvé. Le seul verdict sûr est le refus.
  it("A1 — email collidant un admin local → provisioning REFUSÉ, admin INTACT, aucun compte ajouté", async () => {
    const repo = seedWithAdminVictim();
    const svc = new UserService(repo, encoder);

    await assert.rejects(
      svc.provisionOAuthUser(profileColliding, USER_ONLY),
      IdentifierTakenError,
      "un compte externe non lié ne prend jamais l'identifiant d'un compte local",
    );

    assert.equal(await repo.count(), 1, "zéro compte ajouté, zéro fusion");
    assert.equal(
      await repo.findBySocialProvider("google", "g-attacker-108"),
      null,
      "aucun lien social persisté",
    );
    // Ce que la session rechargerait : toujours la victime, intacte.
    const victim = await svc.loadUserByIdentifier(ADMIN_EMAIL);
    assert.equal(victim.id, "00000000-0000-4000-8000-victimadmin01");
    assert.equal(
      victim.hasRole("ROLE_ADMIN"),
      true,
      "l'admin garde ses droits",
    );
    assert.equal(
      (await repo.findByIdentifier(ADMIN_EMAIL))?.password,
      "pre-hashed-admin-secret",
    );
  });

  // A1b — l'invariant vit dans le DÉPÔT : le store mémoire refuse un doublon
  // comme l'index unique de Drizzle et de Mongoose. Sans lui, tout autre chemin
  // de création (API d'admin, commande, code applicatif) rouvrirait A1.
  it("A1b — le dépôt mémoire refuse un identifiant déjà pris (parité avec l'index unique SQL/document)", async () => {
    const repo = seedWithAdminVictim();
    await assert.rejects(
      repo.create({ identifier: ADMIN_EMAIL, roles: ["ROLE_USER"] }),
      IdentifierTakenError,
    );
    assert.equal(await repo.count(), 1);
  });

  // A2 — un re-login ne ré-écrit jamais les rôles (OAuth = authn, pas authz).
  it("A2 — re-login avec policy ROLE_ADMIN → rôles du Shadow INCHANGÉS (anti-élévation)", async () => {
    const repo = new InMemoryUserRepository();
    const svc = new UserService(repo, encoder);

    const first = await svc.provisionOAuthUser(profileColliding, USER_ONLY);
    assert.deepEqual([...first.roles], ["ROLE_USER"]);

    // L'attaquant rejoue le même compte externe en réclamant ROLE_ADMIN.
    const again = await svc.provisionOAuthUser(profileColliding, {
      defaultRoles: ["ROLE_ADMIN"],
      allowSignup: true,
    });

    assert.equal(
      again.id,
      first.id,
      "même compte (find-or-create), pas de doublon",
    );
    assert.deepEqual(
      [...again.roles],
      ["ROLE_USER"],
      "rôles NON réécrits par re-login",
    );
    assert.equal(
      again.hasRole("ROLE_ADMIN"),
      false,
      "pas d'élévation via policy au re-login",
    );
    assert.equal(await repo.count(), 1, "aucun nouveau compte");
  });

  // A3 — un providerId identique sur deux providers = deux comptes distincts.
  it("A3 — providerId identique cross-provider (google:777 vs github:777) → comptes SÉPARÉS", async () => {
    const repo = new InMemoryUserRepository();
    const svc = new UserService(repo, encoder);

    const g = await svc.provisionOAuthUser(
      {
        provider: "google",
        providerId: "777",
        email: "g@x.io",
        emailVerified: true,
        name: null,
        raw: {},
      },
      USER_ONLY,
    );
    const gh = await svc.provisionOAuthUser(
      {
        provider: "github",
        providerId: "777",
        email: "h@x.io",
        emailVerified: true,
        name: null,
        raw: {},
      },
      USER_ONLY,
    );

    assert.notEqual(
      gh.id,
      g.id,
      "le lien est la PAIRE (provider, providerId), pas l'id seul",
    );
    assert.equal(await repo.count(), 2, "deux comptes distincts");
    // Contrôle : chaque lien ne résout QUE son propre compte.
    const byGoogle = await repo.findBySocialProvider("google", "777");
    const byGithub = await repo.findBySocialProvider("github", "777");
    assert.equal(byGoogle?.id, g.id);
    assert.equal(byGithub?.id, gh.id);
  });
});
