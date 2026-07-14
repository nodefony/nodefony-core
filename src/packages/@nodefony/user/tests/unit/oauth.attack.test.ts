import assert from "node:assert/strict";
import {
  UserService,
  InMemoryUserRepository,
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
 *        NE DOIT PAS lier ce compte : il crée un Shadow User SÉPARÉ (password null,
 *        ROLE_USER) → l'attaquant n'hérite jamais des droits de la victime, et le
 *        compte admin reste INTACT.
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
  it("A1 — email collidant un admin local → Shadow User SÉPARÉ (ROLE_USER, password null), admin INTACT", async () => {
    const repo = seedWithAdminVictim();
    const svc = new UserService(repo, encoder);

    const user = await svc.provisionOAuthUser(profileColliding, USER_ONLY);

    // Le compte rendu n'est PAS la victime : ni son id, ni ses droits.
    assert.notEqual(
      user.id,
      "00000000-0000-4000-8000-victimadmin01",
      "jamais le compte admin",
    );
    assert.equal(
      user.hasRole("ROLE_ADMIN"),
      false,
      "aucune escalade : pas ROLE_ADMIN",
    );
    assert.deepEqual(
      [...user.roles],
      ["ROLE_USER"],
      "rôles = policy de l'appelant",
    );

    // Le Shadow User est 100 % OAuth (aucun credential mot de passe).
    const shadow = await repo.findBySocialProvider("google", "g-attacker-108");
    assert.ok(shadow, "le lien social est persisté");
    assert.equal(
      (shadow as { password: string | null }).password,
      null,
      "Shadow User : password null",
    );

    // La victime n'a pas bougé : toujours admin, toujours son hash. Deux comptes au total.
    const victim = await repo.findByIdentifier(ADMIN_EMAIL);
    // findByIdentifier rend le PREMIER (la victime créée au seed) — elle est intacte.
    assert.equal(
      (victim as { password: string | null }).password,
      "pre-hashed-admin-secret",
    );
    assert.equal(
      victim?.hasRole("ROLE_ADMIN"),
      true,
      "l'admin garde ses droits",
    );
    assert.equal(
      await repo.count(),
      2,
      "un compte ajouté (Shadow), zéro fusion",
    );
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
