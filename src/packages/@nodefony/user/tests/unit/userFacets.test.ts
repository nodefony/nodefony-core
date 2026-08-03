import assert from "node:assert/strict";
import { facetDimensions } from "nodefony";
import { InMemoryUserRepository } from "../../nodefony/src/InMemoryUserRepository";
import {
  USER_FACETS,
  USER_FILTERS,
  USER_STATS_FILTERS,
} from "../../nodefony/src/userFilters";

/**
 * Les COMPTEURS de la console utilisateurs — posés sur l'annuaire ENTIER.
 *
 * Les cartes étaient calculées dans le navigateur, sur la fenêtre chargée
 * (plafonnée à 200) : au-delà, « 12 administrateurs » décrivait les 200 lignes
 * visibles en ayant l'air de décrire l'annuaire. Ce banc verrouille les deux
 * filtres qui rendent les facettes exprimables (`locked`, `hasSocial`), le fait
 * que les populations se RECOUPENT, et l'interdit de filtrer sur /stats une
 * dimension que les cartes décomposent.
 */

const ADMIN = "ROLE_NODEFONY_ADMIN";

/**
 * Annuaire de référence : 6 comptes.
 * - **4 actifs** (activés, non verrouillés) dont **1 administrateur** ;
 * - **1 désactivé** (qui est AUSSI verrouillé — le recoupement) ;
 * - **1 verrouillé** seul ;
 * - **2 comptes sociaux**, répartis des deux côtés.
 */
function seed(): InMemoryUserRepository {
  return new InMemoryUserRepository([
    { id: "u1", identifier: "alice", roles: [ADMIN], password: null },
    { id: "u2", identifier: "bob", roles: [], password: null },
    {
      id: "u3",
      identifier: "chloe",
      roles: [],
      password: null,
      socialProviders: [
        { provider: "github", providerId: "g1", createdAt: new Date(0) },
      ],
    },
    { id: "u4", identifier: "dan", roles: [], password: null },
    {
      id: "u5",
      identifier: "eve",
      roles: [],
      password: null,
      enabled: false,
      locked: true,
      socialProviders: [
        { provider: "google", providerId: "g2", createdAt: new Date(0) },
      ],
    },
    { id: "u6", identifier: "fred", roles: [], password: null, locked: true },
  ]);
}

describe("filtres `locked` et `hasSocial` — les facettes deviennent exprimables", () => {
  it("`locked` distingue le verrouillage de la désactivation", async () => {
    const repo = seed();
    assert.equal(await repo.countUsers({ limit: 1 }), 6);
    assert.equal(
      await repo.countUsers({ limit: 1, locked: true }),
      2,
      "eve et fred",
    );
    assert.equal(
      await repo.countUsers({ limit: 1, enabled: false }),
      1,
      "eve seule est désactivée — fred est verrouillé mais toujours activé",
    );
  });

  it("`hasSocial` compte les comptes liés à un fournisseur externe", async () => {
    const repo = seed();
    assert.equal(await repo.countUsers({ limit: 1, hasSocial: true }), 2);
    assert.equal(await repo.countUsers({ limit: 1, hasSocial: false }), 4);
  });

  it("les filtres se combinent (les deux s'appliquent)", async () => {
    const repo = seed();
    assert.equal(
      await repo.countUsers({ limit: 1, hasSocial: true, locked: true }),
      1,
      "eve : sociale ET verrouillée",
    );
  });

  it("la liste paginée les honore aussi, pas seulement le compteur", async () => {
    const repo = seed();
    const page = await repo.listPage({ limit: 10, locked: true });
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((u) => u.isLocked()));
  });
});

describe("les facettes de l'annuaire", () => {
  it("les populations se RECOUPENT — désactivé et verrouillé sont deux questions", async () => {
    const repo = seed();
    const count = (q: Record<string, unknown>) =>
      repo.countUsers({ limit: 1, ...q });

    assert.equal(await count({}), 6);
    assert.equal(await count({ enabled: true, locked: false }), 4, "actifs");
    assert.equal(await count({ enabled: false }), 1, "désactivés");
    assert.equal(await count({ locked: true }), 2, "verrouillés");
    // 4 + 1 + 2 = 7 > 6 : eve est comptée deux fois, et c'est CORRECT — elle est
    // à la fois désactivée et verrouillée. Aucune facette ne peut donc se
    // déduire des autres par soustraction.
  });

  it("`admins` n'est PAS dans la table — le rôle est une valeur de config", () => {
    assert.ok(
      !Object.keys(USER_FACETS).includes("admins"),
      "l'y inscrire figerait ROLE_NODEFONY_ADMIN pour une plateforme qui peut le renommer",
    );
  });
});

describe("la spec de /stats ne filtre JAMAIS ce que les facettes décomposent", () => {
  it("`enabled`, `locked` et `hasSocial` sont exclus ; `role` reste", () => {
    const dims = facetDimensions(USER_FACETS);
    assert.deepEqual(dims, ["enabled", "hasSocial", "locked"]);
    for (const dim of dims) {
      assert.ok(
        !Object.hasOwn(USER_STATS_FILTERS, dim),
        `\`${dim}\` est décomposé en facettes : le filtrer rendrait une réponse ` +
          `qui se contredit (un total suivant le filtre, des facettes l'écrasant).`,
      );
      assert.ok(
        Object.hasOwn(USER_FILTERS, dim),
        `\`${dim}\` doit rester filtrable sur la LISTE — c'est ce qui rend la ` +
          `carte cliquable.`,
      );
    }
    assert.ok(Object.hasOwn(USER_STATS_FILTERS, "role"));
  });
});
