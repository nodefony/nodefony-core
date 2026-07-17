import assert from "node:assert/strict";
import type { IUserRepository } from "../../index";

/**
 * **Banc de contrat UNIQUE** du standard de pagination utilisateur
 * (`IUserRepository.listPage` / `countActiveAdmins`). Backend-agnostique : il ne
 * dépend que du contrat, et se branche sur N'IMPORTE quel store via un harness
 * (mémoire, Drizzle × sqlite/postgres/mysql, Mongoose). Un écart de comportement
 * entre stores/dialectes = un bug du framework, par construction.
 *
 * Vit dans `@nodefony/user` — le **propriétaire du contrat** — pour être importé
 * par tous les adapters (jamais dupliqué). Le seed est déterministe :
 * `user00@x` … `user24@x`, admins sur les ×5 (5 admins), désactivés sur les ×7
 * (4 inactifs, dont l'admin 0) → **4 admins actifs**.
 */
export const ADMIN_ROLE = "ROLE_NODEFONY_ADMIN";

/** Une ligne de seed (identité + rôles + état) — insérée telle quelle par le store. */
export interface UserSeedRow {
  identifier: string;
  roles: string[];
  enabled: boolean;
}

/** Adaptation d'un store concret au banc : accès au repo + seed + purge. */
export interface UserPaginationHarness {
  /** Le repository sous test (résolu paresseusement — l'ORM est prêt au 1er appel). */
  users: () => IUserRepository;
  /** Insère les lignes de seed dans le store (via son repo de base). */
  insert: (rows: UserSeedRow[]) => Promise<void>;
  /** Vide la collection avant le seed (banc idempotent). */
  clear: () => Promise<void>;
}

/** Le seed déterministe partagé par tous les backends (garantit la parité d'assertions). */
export function paginationSeed(): UserSeedRow[] {
  const out: UserSeedRow[] = [];
  for (let i = 0; i < 25; i += 1) {
    const n = String(i).padStart(2, "0");
    out.push({
      identifier: `user${n}@x`,
      roles: i % 5 === 0 ? [ADMIN_ROLE] : ["ROLE_USER"],
      enabled: i % 7 !== 0,
    });
  }
  return out;
}

/**
 * Déroule la suite du contrat de pagination sur le store branché par `harness`.
 * Utilise les globals de test (`describe`/`it`/`beforeAll`) — à appeler depuis un
 * fichier `*.test.ts` du package du store.
 */
export function runUserPaginationContract(
  harness: UserPaginationHarness,
): void {
  describe("listPage / countActiveAdmins — contrat de pagination natif", () => {
    beforeAll(async () => {
      await harness.clear();
      await harness.insert(paginationSeed());
    });
    const repo = () => harness.users();

    it("page + total + hasNext (tri identifier ASC par défaut)", async () => {
      const first = await repo().listPage({ limit: 10, offset: 0 });
      assert.equal(first.total, 25);
      assert.equal(first.items.length, 10);
      assert.equal(first.hasNext, true);
      assert.equal(first.items[0].identifier, "user00@x");
      assert.equal(first.items[9].identifier, "user09@x");

      const last = await repo().listPage({ limit: 10, offset: 20 });
      assert.equal(last.items.length, 5);
      assert.equal(last.hasNext, false);
      assert.equal(last.items[0].identifier, "user20@x");
    });

    it("filtre role = containment natif du tableau JSON roles", async () => {
      const page = await repo().listPage({ limit: 100, role: ADMIN_ROLE });
      assert.equal(page.total, 5);
      assert.deepEqual(
        page.items.map((u) => u.identifier),
        ["user00@x", "user05@x", "user10@x", "user15@x", "user20@x"],
      );
    });

    it("filtre enabled = false (isActive dérivé)", async () => {
      const page = await repo().listPage({ limit: 100, enabled: false });
      assert.equal(page.total, 4);
      assert.ok(page.items.every((u) => u.isActive() === false));
    });

    it("filtre q = sous-chaîne insensible à la casse sur identifier", async () => {
      const page = await repo().listPage({ limit: 10, q: "USER00" });
      assert.equal(page.total, 1);
      assert.equal(page.items[0].identifier, "user00@x");
    });

    it("filtres combinés role + enabled → admins ACTIFS", async () => {
      const page = await repo().listPage({
        limit: 100,
        role: ADMIN_ROLE,
        enabled: true,
      });
      assert.equal(page.total, 4);
      assert.ok(!page.items.some((u) => u.identifier === "user00@x"));
    });

    it("withTotal:false → total omis, hasNext fiable (mode Slice)", async () => {
      const page = await repo().listPage({ limit: 10, withTotal: false });
      assert.equal(page.total, undefined);
      assert.equal(page.items.length, 10);
      assert.equal(page.hasNext, true);
    });

    it("order custom (identifier DESC)", async () => {
      const page = await repo().listPage({
        limit: 3,
        order: [["identifier", "DESC"]],
      });
      assert.deepEqual(
        page.items.map((u) => u.identifier),
        ["user24@x", "user23@x", "user22@x"],
      );
    });

    it("countActiveAdmins : actifs porteurs du rôle (ignore inactifs/non-admins)", async () => {
      assert.equal(await repo().countActiveAdmins(ADMIN_ROLE), 4);
    });

    it("q hostile bindé : pas d'injection LIKE/regex, 0 match", async () => {
      const page = await repo().listPage({ limit: 100, q: "%'; DROP TABLE" });
      assert.equal(page.total, 0);
      assert.equal(page.items.length, 0);
    });
  });
}
