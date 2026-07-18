/// <reference types="node" />
import assert from "node:assert/strict";
import type { ISessionStorage } from "../../interfaces/ISession";

/**
 * **Banc de contrat COMPORTEMENTAL** d'un `ISessionStorage` — le cycle de vie
 * d'une session (écrire, relire, prolonger, détruire, expirer), indépendamment
 * de la pagination (banc frère `sessionPaginationContract`).
 *
 * Pourquoi ce banc existe : la session porte l'identité de **chaque requête
 * authentifiée**. Ses invariants ne sont pas des détails d'implémentation d'un
 * backend — ce sont des propriétés de sécurité (NIST/OWASP) qui doivent tenir
 * quel que soit le store branché. Les vérifier une fois par backend, à la main,
 * garantit qu'elles divergeront ; les vérifier **par un banc unique** garantit
 * qu'un écart devient un test rouge.
 *
 * **Capacités déclarées** plutôt que supposées : un store à TTL natif (Redis) a
 * un `gc()` no-op — c'est le TTL qui expire les clés, pas un balayage. Le banc
 * n'exige donc pas de lui la même chose qu'à un store SQL, il exige de chacun
 * ce qu'il annonce. On teste la nature du backend, pas une parité de façade.
 */
export interface SessionStoreHarness {
  /** Le store sous test (résolu paresseusement). */
  storage: () => ISessionStorage;
  /** Vide le store avant chaque groupe (banc idempotent). */
  clear: () => Promise<void>;
  /**
   * Comment l'expiration est réalisée :
   * - `applicative` : `gc()` purge (SQL, mémoire) → le banc l'exerce ;
   * - `native-ttl` : le backend expire seul (Redis `EX`) → `gc()` doit être un
   *   no-op SILENCIEUX (ne jamais jeter), l'expiration est prouvée à part.
   */
  expiry: "applicative" | "native-ttl";
  /** `true` si le store implémente `touch` (prolongation d'idle sans réécriture). */
  touch: boolean;
}

/** Corps de session minimal, avec des sacs non triviaux (round-trip JSON réel). */
function body(user: string) {
  return {
    Attributes: { cart: ["a", "b"], depth: { n: 1 } },
    metaBag: { ip: "10.0.0.1", ua: "banc" },
    flashBag: { notice: "hello" },
    user,
  };
}

/** Déroule le contrat comportemental du store de session sur le backend branché. */
export function runSessionStoreContract(harness: SessionStoreHarness): void {
  const storage = () => harness.storage();

  describe(`ISessionStorage — contrat comportemental (${harness.expiry})`, () => {
    beforeAll(async () => {
      await harness.clear();
    });

    describe("write / read", () => {
      it("round-trip complet : sacs JSON, user, horodatages", async () => {
        await storage().write("c-1", body("alice"));
        const r = await storage().read("c-1");
        assert.deepEqual(r.Attributes, { cart: ["a", "b"], depth: { n: 1 } });
        assert.deepEqual(r.metaBag, { ip: "10.0.0.1", ua: "banc" });
        assert.deepEqual(r.flashBag, { notice: "hello" });
        assert.equal(r.user, "alice");
      });

      it("`createdAt` est INSERT-ONLY (le timeout absolu ne rajeunit jamais)", async () => {
        // LA propriété de sécurité du store : `createdAt` borne l'absolute
        // timeout NIST. Si une réécriture l'écrasait, la session rajeunirait à
        // chaque requête — donc n'expirerait jamais, et un vol de cookie
        // deviendrait un accès permanent.
        const before = await storage().read("c-1");
        const createdAt = new Date(before.createdAt as unknown as string);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await storage().write("c-1", { ...body("alice2"), createdAt });
        const after = await storage().read("c-1");
        assert.equal(after.user, "alice2", "le reste est bien mis à jour");
        assert.equal(
          new Date(after.createdAt as unknown as string).getTime(),
          createdAt.getTime(),
          "createdAt doit être préservé à l'identique",
        );
      });

      it("`updatedAt` avance à chaque écriture (borne idle)", async () => {
        const before = await storage().read("c-1");
        const t0 = new Date(before.updatedAt as unknown as string).getTime();
        await new Promise((resolve) => setTimeout(resolve, 5));
        await storage().write("c-1", body("alice2"));
        const after = await storage().read("c-1");
        assert.ok(
          new Date(after.updatedAt as unknown as string).getTime() > t0,
          "updatedAt doit refléter la dernière activité",
        );
      });

      it("read d'un id inconnu → objet VIDE, jamais une erreur", async () => {
        // Un cookie périmé ou forgé ne doit pas produire un 500 : la session
        // repart vide et le pipeline continue en anonyme.
        const r = await storage().read("jamais-vu");
        assert.deepEqual(r.Attributes ?? {}, {});
        assert.ok(!r.user);
      });

      it("start se comporte comme read (reprise d'une session existante)", async () => {
        const r = await storage().start("c-1");
        assert.equal(r.user, "alice2");
      });
    });

    describe("destroy", () => {
      it("détruit la session : la relecture repart vide", async () => {
        await storage().write("d-1", body("bob"));
        assert.equal(await storage().destroy("d-1"), true);
        const r = await storage().read("d-1");
        assert.deepEqual(r.Attributes ?? {}, {});
        assert.ok(!r.user);
      });

      it("est IDEMPOTENT : détruire deux fois ne jette pas", async () => {
        // La révocation est rejouable (double-clic admin, retry réseau) — elle
        // ne doit jamais transformer un no-op en erreur 500.
        await storage().destroy("d-1");
        await storage().destroy("jamais-existe");
      });
    });

    if (harness.touch) {
      describe("touch (idle glissant)", () => {
        it("prolonge la session SANS altérer son contenu", async () => {
          await storage().write("t-1", body("carol"));
          const before = await storage().read("t-1");
          await storage().touch!("t-1", 3600);
          const after = await storage().read("t-1");
          assert.equal(after.user, before.user);
          assert.deepEqual(after.Attributes, before.Attributes);
        });

        it("sur une session absente : silencieux (jamais une erreur)", async () => {
          await storage().touch!("t-absente", 3600);
        });
      });
    }

    describe("gc", () => {
      if (harness.expiry === "applicative") {
        it("purge les sessions inactives au-delà de l'idle", async () => {
          await harness.clear();
          await storage().write("gc-1", body("dave"));
          // idle = 0 s → tout est expiré ; on prouve que le balayage agit.
          await new Promise((resolve) => setTimeout(resolve, 5));
          await storage().gc(0.001, 0);
          const r = await storage().read("gc-1");
          assert.ok(!r.user, "la session inactive doit avoir été purgée");
        });

        it("ne purge PAS une session encore active", async () => {
          await storage().write("gc-2", body("erin"));
          await storage().gc(3600, 0);
          assert.equal((await storage().read("gc-2")).user, "erin");
        });
      } else {
        it("est un no-op SILENCIEUX (l'expiration est portée par le TTL natif)", async () => {
          // Le contrat autorise le no-op ; ce qu'il n'autorise pas, c'est de
          // jeter — `gc` est appelé par un timer en fire-and-forget, une
          // exception y deviendrait un `unhandledRejection`.
          await storage().write("gc-ttl", body("frank"));
          await storage().gc(1, 1);
          assert.equal(
            (await storage().read("gc-ttl")).user,
            "frank",
            "un store à TTL natif ne purge pas lui-même",
          );
        });
      }
    });
  });
}
