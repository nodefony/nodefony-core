import assert from "node:assert/strict";
import {
  BaseUser,
  InMemoryUserRepository,
  UserService,
  type AuthFailureReason,
  type IPasswordAuthenticatedUser,
  type IPasswordEncoder,
} from "../../index";

/**
 * RED-TEAM — brique **Password** (verifier `UserService.authenticate`).
 *
 * Cible : l'**énumération de comptes par timing**. Le message d'échec est déjà
 * uniforme (`null` → 401 « Invalid credentials »), mais un attaquant peut
 * distinguer les comptes par le TEMPS DE RÉPONSE si certains chemins d'échec
 * court-circuitent le hachage (coûteux, ~constant) que paient les autres.
 *
 * Preuve par COMPTAGE plutôt que par chronomètre (déterministe, sans flakiness) :
 * un {@link CountingEncoder} instrumente `hash`/`verify`. L'invariant de sécurité
 * est « **tout** appel à `authenticate` consomme exactement UNE opération de
 * vérification de hash, succès comme échec » — si un chemin en consomme zéro, il
 * est plus rapide → oracle. Couvre aussi : le leurre est calculé une seule fois
 * (lazy) et utilise l'input ATTAQUANT (le temps suit la taille saisie, comme un
 * vrai verify), et la raison fine ne fuite jamais dans la valeur de retour.
 */

// Encodeur déterministe et instrumenté — AUCUNE vraie crypto (on mesure des
// APPELS, pas des millisecondes). Un hash est `enc$<clair>` ; verify compare.
class CountingEncoder implements IPasswordEncoder {
  hashes = 0;
  verifies = 0;
  // Derniers clairs soumis à verify — prouve que le leurre verify l'input réel.
  readonly verifiedPlains: string[] = [];

  supports(hash: string): boolean {
    return hash.startsWith("enc$");
  }

  hash(plain: string): Promise<string> {
    this.hashes += 1;
    return Promise.resolve(`enc$${plain}`);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    this.verifies += 1;
    this.verifiedPlains.push(plain);
    return Promise.resolve(hash === `enc$${plain}`);
  }

  // Pas de re-hash : isole l'invariant « 1 verify » du chemin de migration de coût.
  needsRehash(): boolean {
    return false;
  }
}

interface Harness {
  service: UserService;
  encoder: CountingEncoder;
  reasons: AuthFailureReason[];
}

// Parc : compte actif (good), verrouillé, désactivé, sans password (OAuth).
async function setup(): Promise<Harness> {
  const encoder = new CountingEncoder();
  const service = new UserService(new InMemoryUserRepository(), encoder);
  const reasons: AuthFailureReason[] = [];
  service.on("onAuthenticationFailure", (_id, reason) => {
    reasons.push(reason as AuthFailureReason);
  });

  await service.createUser({
    identifier: "active@x.io",
    plainPassword: "good",
  });
  const locked = await service.createUser({
    identifier: "locked@x.io",
    plainPassword: "good",
  });
  (locked as BaseUser).lock();
  const disabled = await service.createUser({
    identifier: "disabled@x.io",
    plainPassword: "good",
  });
  (disabled as BaseUser).disable();
  await service.createUser({ identifier: "oauth@x.io" }); // password null

  return { service, encoder, reasons };
}

// Tous les chemins d'ÉCHEC, avec la raison d'audit attendue. Le mot de passe est
// volontairement faux partout sauf indication — on teste le COÛT, pas le verdict.
const FAILURE_PATHS: Array<{
  label: string;
  identifier: string;
  password: string;
  reason: AuthFailureReason;
}> = [
  {
    label: "identifiant inconnu",
    identifier: "ghost@x.io",
    password: "whatever",
    reason: "unknown_identifier",
  },
  {
    label: "compte verrouillé",
    identifier: "locked@x.io",
    password: "good",
    reason: "locked",
  },
  {
    label: "compte désactivé",
    identifier: "disabled@x.io",
    password: "good",
    reason: "disabled",
  },
  {
    label: "compte sans mot de passe (OAuth)",
    identifier: "oauth@x.io",
    password: "whatever",
    reason: "no_password",
  },
  {
    label: "mauvais mot de passe",
    identifier: "active@x.io",
    password: "wrong",
    reason: "bad_credentials",
  },
];

describe("RED-TEAM Password — UserService.authenticate (anti-énumération par timing)", () => {
  describe("invariant : chaque chemin d'échec consomme EXACTEMENT 1 verify", () => {
    for (const path of FAILURE_PATHS) {
      it(`${path.label} → null + raison ${path.reason} + 1 verify`, async () => {
        const { service, encoder, reasons } = await setup();
        const before = encoder.verifies;

        const result = await service.authenticate(
          path.identifier,
          path.password,
        );

        // Retour uniforme : null, jamais la raison fine (fuite d'info interdite).
        assert.equal(result, null);
        // La raison part en audit (serveur), pas au client.
        assert.equal(reasons.at(-1), path.reason);
        // Cœur du test : le hash a bien été payé (verify réel ou leurre) → ce
        // chemin n'est PAS plus rapide que les autres. Avant le fix, locked et
        // disabled valaient 0 → oracle de timing.
        assert.equal(
          encoder.verifies - before,
          1,
          `${path.label} : ${encoder.verifies - before} verify (oracle de timing si ≠ 1)`,
        );
      });
    }

    it("le succès consomme aussi 1 verify (indistinguable d'un échec)", async () => {
      const { service, encoder } = await setup();
      const before = encoder.verifies;
      const user = await service.authenticate("active@x.io", "good");
      assert.equal(
        (user as IPasswordAuthenticatedUser).identifier,
        "active@x.io",
      );
      assert.equal(encoder.verifies - before, 1);
    });

    it("0 oracle : TOUS les chemins d'échec ont le même coût de verify", async () => {
      const { service, encoder } = await setup();
      const costs: number[] = [];
      for (const path of FAILURE_PATHS) {
        const before = encoder.verifies;
        await service.authenticate(path.identifier, path.password);
        costs.push(encoder.verifies - before);
      }
      // Un seul coût distinct (1) → aucun chemin n'est distinguable par le temps.
      assert.deepEqual([...new Set(costs)], [1], `coûts hétérogènes: ${costs}`);
    });
  });

  describe("hash leurre — calculé une seule fois et alimenté par l'input attaquant", () => {
    it("le leurre est haché LAZY puis caché (1 seul hash pour N échecs sans credential réel)", async () => {
      const { service, encoder } = await setup();
      const hashesAfterSeed = encoder.hashes; // hash des 3 comptes seedés
      // 5 identifiants inconnus + le compte OAuth : tous passent par le leurre.
      for (let i = 0; i < 5; i++) {
        await service.authenticate(`ghost-${i}@x.io`, "x");
      }
      await service.authenticate("oauth@x.io", "x");
      // Le leurre n'est haché qu'UNE fois (première consommation) puis réutilisé.
      assert.equal(encoder.hashes - hashesAfterSeed, 1);
    });

    it("le leurre verify le mot de passe SAISI (le temps suit la taille de l'input, pas une constante)", async () => {
      const { service, encoder } = await setup();
      encoder.verifiedPlains.length = 0;
      await service.authenticate("ghost@x.io", "attacker-supplied-secret");
      // Sur un identifiant inconnu, c'est bien le clair de l'attaquant qui est
      // passé au verify leurre — sinon le timing varierait avec l'input réel vs
      // dummy et rouvrirait un oracle.
      assert.deepEqual(encoder.verifiedPlains, ["attacker-supplied-secret"]);
    });
  });

  describe("anti-fuite : la valeur de retour ne porte JAMAIS la cause", () => {
    it("inconnu, verrouillé, désactivé, sans-password, mauvais-mdp → tous null", async () => {
      const { service } = await setup();
      const results = await Promise.all(
        FAILURE_PATHS.map((p) =>
          service.authenticate(p.identifier, p.password),
        ),
      );
      assert.deepEqual(results, [null, null, null, null, null]);
    });
  });
});
