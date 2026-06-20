import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Authorization } from "../../nodefony/service/authorization";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { RoleHierarchyWalker } from "../../nodefony/src/RoleHierarchyWalker";
import { VoterVote } from "../../nodefony/contracts/IAccessVoter";
import type { IAccessVoter } from "../../nodefony/contracts/IAccessVoter";
import { registerVoterFactory } from "../../nodefony/src/voter/voterRegistry";

/**
 * Matrice d'ATTAQUE (red-team) sur l'autorisation niveau A — le cœur RBAC :
 * {@link RoleHierarchyWalker} + `RoleVoter` (built-in `role`) + `AuthorizationService`.
 *
 * Complète `authorization.test.ts` (qui prouve la STRATÉGIE : affirmative + DENY
 * veto, default DENY). Ici on attaque le maillon le plus exposé sous l'angle de
 * l'attaquant, sur le VRAI walker / VRAI voter / VRAI service (jamais de stub de
 * `decide`) :
 *
 *   1. Escalade verticale REFUSÉE — la hiérarchie est UNIDIRECTIONNELLE
 *      (ROLE_ADMIN ⊇ ROLE_USER, jamais l'inverse). Un ROLE_USER ne devient pas
 *      ROLE_ADMIN, un ROLE_ADMIN ne devient pas ROLE_SUPERADMIN.
 *   2. DoS par hiérarchie cyclique — un cycle de config échoue FAIL-FAST au boot
 *      (throw avec le chemin), jamais une boucle infinie au runtime.
 *   3. Confusion d'attribut — une permission (non `ROLE_*`) sans voter dédié, un
 *      préfixe nu `ROLE_`, ou une casse divergente ne FUIT JAMAIS en GRANT
 *      (deny-by-default exact, pas laxiste).
 *   4. Non-véto du RoleVoter — l'absence d'un rôle vote ABSTAIN (jamais DENY) :
 *      indispensable pour composer « rôle OU ownership » ; un VRAI DENY véto bien.
 *
 * Isolation : Vitest recharge les modules par fichier → le registre de voters ne
 * contient ici que le built-in `role` + les stubs ci-dessous (attributs distincts,
 * 0 interférence entre groupes).
 */

const fakeUser = (identifier: string, roles: string[]): IUser => ({
  id: "00000000-0000-4000-8000-00000000000a",
  identifier,
  roles,
  hasRole: (r: string) => roles.includes(r),
  isActive: () => true,
  isLocked: () => false,
});

const authedToken = (roles: string[], identifier = "mallory") =>
  new UserToken("test", null).promote(fakeUser(identifier, roles));

function makeService(container: Container): Authorization {
  return new Authorization({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
}

/** Container avec une hiérarchie posée (comme le firewall au boot). */
function withHierarchy(
  hierarchy: Record<string, readonly string[]>,
): Container {
  const c = new Container();
  c.set("roleHierarchy", new RoleHierarchyWalker(hierarchy));
  return c;
}

/** Voter de test : ne supporte qu'un attribut, vote un verdict figé. */
class StubVoter implements IAccessVoter {
  constructor(
    private readonly attr: string,
    private readonly verdict: VoterVote,
  ) {}
  supports(attribute: string): boolean {
    return attribute === this.attr;
  }
  vote(): Promise<VoterVote> {
    return Promise.resolve(this.verdict);
  }
}

// Voters métier de test (attributs DISTINCTS par groupe → 0 collision). Le
// built-in `role` est déjà enregistré (import du module).
registerVoterFactory(
  "atk-owner-grant",
  () => new StubVoter("post.delete", VoterVote.GRANT),
); // group 3/4 : permission accordée par un voter dédié
registerVoterFactory(
  "atk-compose-grant",
  () => new StubVoter("ROLE_GRANTABLE", VoterVote.GRANT),
); // group 4 : GRANT sur un ROLE_* que l'user n'a pas
registerVoterFactory(
  "atk-vetoed-grant",
  () => new StubVoter("ROLE_VETOED", VoterVote.GRANT),
);
registerVoterFactory(
  "atk-vetoed-deny",
  () => new StubVoter("ROLE_VETOED", VoterVote.DENY),
);

describe("Authorization red-team — escalade verticale REFUSÉE (hiérarchie unidirectionnelle)", () => {
  // ROLE_SUPERADMIN ⊃ ROLE_ADMIN ⊃ ROLE_USER. L'héritage descend, jamais ne remonte.
  const H = {
    ROLE_SUPERADMIN: ["ROLE_ADMIN"],
    ROLE_ADMIN: ["ROLE_USER"],
  };

  it("walker : ROLE_USER NE satisfait PAS ROLE_ADMIN (pas de remontée)", () => {
    const walker = new RoleHierarchyWalker(H);
    assert.equal(walker.hasRole(["ROLE_USER"], "ROLE_ADMIN"), false);
  });

  it("walker : ROLE_ADMIN NE satisfait PAS ROLE_SUPERADMIN", () => {
    const walker = new RoleHierarchyWalker(H);
    assert.equal(walker.hasRole(["ROLE_ADMIN"], "ROLE_SUPERADMIN"), false);
  });

  it("walker : contrôle positif — ROLE_SUPERADMIN satisfait ROLE_USER (transitif descendant)", () => {
    const walker = new RoleHierarchyWalker(H);
    assert.equal(walker.hasRole(["ROLE_SUPERADMIN"], "ROLE_USER"), true);
  });

  it("service : un ROLE_USER sur une garde ROLE_ADMIN → refus (escalade bloquée)", async () => {
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_USER"]),
        "ROLE_ADMIN",
      ),
      false,
    );
  });

  it("service : un rôle FRÈRE non hérité (ROLE_AUDITOR) → refus", async () => {
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_USER"]),
        "ROLE_AUDITOR",
      ),
      false,
    );
  });

  it("service : rôle plat INCONNU (ROLE_GHOST) ne satisfait rien", async () => {
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_GHOST"]),
        "ROLE_ADMIN",
      ),
      false,
    );
  });

  it("service : token SANS aucun rôle → refus (deny-by-default)", async () => {
    assert.equal(
      await makeService(withHierarchy(H)).decide(authedToken([]), "ROLE_USER"),
      false,
    );
  });
});

describe("Authorization red-team — DoS par hiérarchie cyclique (fail-fast au boot)", () => {
  it("cycle direct {A→B, B→A} → throw au constructeur (jamais de boucle infinie)", () => {
    assert.throws(
      () => new RoleHierarchyWalker({ ROLE_A: ["ROLE_B"], ROLE_B: ["ROLE_A"] }),
      /cycle/i,
    );
  });

  it("self-cycle {A→A} → throw", () => {
    assert.throws(
      () => new RoleHierarchyWalker({ ROLE_A: ["ROLE_A"] }),
      /cycle/i,
    );
  });

  it("cycle profond {A→B→C→A} → throw + chemin diagnostiqué", () => {
    assert.throws(
      () =>
        new RoleHierarchyWalker({
          ROLE_A: ["ROLE_B"],
          ROLE_B: ["ROLE_C"],
          ROLE_C: ["ROLE_A"],
        }),
      (e: unknown) =>
        e instanceof Error &&
        /cycle/i.test(e.message) &&
        e.message.includes("→"),
    );
  });

  it("DAG en diamant {A→B,A→C,B→D,C→D} → PAS un cycle (D partagé), termine, transitif", () => {
    // Le rôle partagé D ne doit pas être pris pour un cycle (faux positif) ni
    // faire diverger l'aplatissement (D visité une seule fois).
    const walker = new RoleHierarchyWalker({
      ROLE_A: ["ROLE_B", "ROLE_C"],
      ROLE_B: ["ROLE_D"],
      ROLE_C: ["ROLE_D"],
    });
    assert.equal(walker.hasRole(["ROLE_A"], "ROLE_D"), true);
    assert.deepEqual([...walker.reachableRoles(["ROLE_A"])].sort(), [
      "ROLE_A",
      "ROLE_B",
      "ROLE_C",
      "ROLE_D",
    ]);
  });
});

describe("Authorization red-team — confusion d'attribut (anti-fuite GRANT)", () => {
  const H = { ROLE_ADMIN: ["ROLE_USER"] };

  it("permission (non ROLE_*) SANS voter dédié → refus, même pour un ROLE_ADMIN", async () => {
    // "doc.edit" : le RoleVoter ne le supporte pas (≠ ROLE_*), aucun autre voter
    // ne le couvre → no-voter → DENY. Un admin ne « grimpe » jamais une permission.
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_ADMIN"]),
        "doc.edit",
      ),
      false,
    );
  });

  it("permission AVEC voter dédié → GRANT (le deny-by-default tient à la COUVERTURE, pas au hasard)", async () => {
    // Même forme que ci-dessus, mais "post.delete" a un voter (atk-owner-grant).
    // Contrôle positif : prouve que le refus de "doc.edit" vient de l'absence de
    // voter, pas d'un rejet global des attributs non-ROLE.
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_ADMIN"]),
        "post.delete",
      ),
      true,
    );
  });

  it("préfixe nu 'ROLE_' → supporté mais jamais possédé → refus", async () => {
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_ADMIN"]),
        "ROLE_",
      ),
      false,
    );
  });

  it("casse divergente : garde 'role_admin' (minuscule) → refus (RoleVoter strict, pas de bypass laxiste)", async () => {
    // supports() est sensible à la casse (startsWith "ROLE_") → "role_admin" n'est
    // supporté par AUCUN voter → no-voter → DENY. Une faute de casse FERME la porte
    // (fail-closed), elle ne l'ouvre jamais.
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_ADMIN"]),
        "role_admin",
      ),
      false,
    );
  });
});

describe("Authorization red-team — RoleVoter ABSTAIN, jamais DENY (composition d'axes)", () => {
  const H = { ROLE_ADMIN: ["ROLE_USER"] };

  it("RoleVoter sur un rôle absent ABSTIENT → un GRANT d'un autre axe passe (compose rôle OU ownership)", async () => {
    // Jury sur "ROLE_GRANTABLE" : [role(ABSTAIN, user ne l'a pas), atk-compose-grant(GRANT)].
    // Si le RoleVoter votait DENY, il vétoait le GRANT → false. On exige true.
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_USER"]),
        "ROLE_GRANTABLE",
      ),
      true,
    );
  });

  it("contrôle : un VRAI DENY véto bien le GRANT du même attribut", async () => {
    // Jury sur "ROLE_VETOED" : [role(ABSTAIN), atk-vetoed-grant(GRANT), atk-vetoed-deny(DENY)].
    // Le DENY l'emporte → false. Prouve que l'ABSTAIN du RoleVoter n'a pas
    // « désarmé » la stratégie de veto.
    assert.equal(
      await makeService(withHierarchy(H)).decide(
        authedToken(["ROLE_USER"]),
        "ROLE_VETOED",
      ),
      false,
    );
  });
});
