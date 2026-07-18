import assert from "node:assert/strict";
import type { ITotpSecret, ITotpSecretStore } from "../../index";

/**
 * **Banc de contrat UNIQUE** du listing paginé des enrôlements 2FA
 * (`ITotpSecretStore.listPage` / `countEnrollments`). Backend-agnostique : se
 * branche sur n'importe quel store via un harness (mémoire, Drizzle ×
 * sqlite/postgres/mysql). Vit chez le propriétaire du contrat.
 *
 * Il porte une exigence de SÉCURITÉ, pas seulement de pagination : la vue rendue
 * ne doit contenir NI le secret partagé (réversible → il générerait les codes de
 * la victime), NI les condensats des codes de récupération. Un backend qui
 * élargirait sa projection casse ici.
 *
 * Seed déterministe : 10 enrôlements `u-00`…`u-09`, `createdAt` croissants ;
 * confirmés sauf les ×3 (4 en attente) ; 8 codes de récupération, sauf `u-00`
 * qui les a tous consommés.
 */

/** Fabrique un secret complet (défauts sûrs) — seul l'`userId` est requis. */
export function makeTotpSecret(
  over: Partial<ITotpSecret> & { userId: string },
): ITotpSecret {
  return {
    userId: over.userId,
    secretEnc: over.secretEnc ?? `gcm1.${over.userId}`,
    algorithm: over.algorithm ?? "SHA1",
    digits: over.digits ?? 6,
    period: over.period ?? 30,
    recoveryCodes:
      over.recoveryCodes ?? Array.from({ length: 8 }, (_, i) => `h${i}`),
    confirmedAt: over.confirmedAt ?? null,
    lastUsedStep: over.lastUsedStep ?? null,
    createdAt: over.createdAt ?? 0,
    lastUsedAt: over.lastUsedAt ?? null,
  };
}

/** Le seed déterministe partagé par tous les backends. */
export function totpSeed(): ITotpSecret[] {
  const out: ITotpSecret[] = [];
  for (let i = 0; i < 10; i += 1) {
    const confirmed = i % 3 !== 0;
    out.push(
      makeTotpSecret({
        userId: `u-${String(i).padStart(2, "0")}`,
        createdAt: 1000 + i,
        confirmedAt: confirmed ? 5000 + i : null,
        lastUsedAt: confirmed ? 6000 + i : null,
        recoveryCodes:
          i === 0 ? [] : Array.from({ length: 8 }, (_, k) => `h${k}`),
      }),
    );
  }
  return out;
}

export interface TotpPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => ITotpSecretStore;
  /** Vide le store avant le seed (banc idempotent). */
  clear: () => Promise<void>;
}

/** Déroule la suite du contrat de listing 2FA sur le store branché. */
export function runTotpPaginationContract(
  harness: TotpPaginationHarness,
): void {
  describe("listPage / countEnrollments — contrat de listing 2FA", () => {
    beforeAll(async () => {
      await harness.clear();
      for (const secret of totpSeed()) await harness.store().save(secret);
    });
    const store = () => harness.store();

    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 4 });
      assert.ok(page.items.length <= 4);
      assert.equal(page.limit, 4);
    });

    it("page + total + hasNext (tri createdAt DESC)", async () => {
      const first = await store().listPage({ limit: 4, offset: 0 });
      assert.equal(first.total, 10);
      assert.equal(first.items.length, 4);
      assert.equal(first.hasNext, true);
      assert.equal(first.items[0].userId, "u-09");
      assert.equal(first.items[3].userId, "u-06");

      const last = await store().listPage({ limit: 4, offset: 8 });
      assert.equal(last.items.length, 2);
      assert.equal(last.hasNext, false);
      assert.equal(last.items[1].userId, "u-00");
    });

    it("parcours complet : 10 enrôlements DISTINCTS, aucun perdu", async () => {
      const seen = new Set<string>();
      for (let offset = 0; offset < 10; offset += 4) {
        const page = await store().listPage({ limit: 4, offset });
        for (const e of page.items) seen.add(e.userId);
      }
      assert.equal(seen.size, 10);
    });

    it("filtre confirmed : les enrôlements RESTÉS en attente sont trouvables", async () => {
      const pending = await store().listPage({ limit: 100, confirmed: false });
      assert.equal(pending.total, 4);
      assert.ok(pending.items.every((e) => e.confirmedAt === null));

      const done = await store().listPage({ limit: 100, confirmed: true });
      assert.equal(done.total, 6);
      assert.ok(done.items.every((e) => e.confirmedAt !== null));
    });

    it("q filtre par PRÉFIXE d'userId", async () => {
      assert.equal(
        (await store().listPage({ limit: 100, q: "u-0" })).total,
        10,
      );
      assert.equal(
        (await store().listPage({ limit: 100, q: "u-04" })).total,
        1,
      );
      assert.equal((await store().listPage({ limit: 100, q: "zzz" })).total, 0);
    });

    it("withTotal:false → total omis, hasNext fiable", async () => {
      const page = await store().listPage({ limit: 4, withTotal: false });
      assert.equal(page.total, undefined);
      assert.equal(page.hasNext, true);
    });

    it("countEnrollments = COUNT natif filtré (KPI couverture 2FA)", async () => {
      assert.equal(await store().countEnrollments({ limit: 1 }), 10);
      assert.equal(
        await store().countEnrollments({ limit: 1, confirmed: true }),
        6,
      );
    });

    it("🔒 la vue ne porte NI le secret NI les condensats de récupération", async () => {
      const page = await store().listPage({ limit: 100 });
      for (const item of page.items) {
        const raw = item as unknown as Record<string, unknown>;
        assert.equal(raw.secretEnc, undefined, "secretEnc ne doit pas sortir");
        assert.equal(
          raw.recoveryCodes,
          undefined,
          "les condensats ne doivent pas sortir",
        );
        assert.equal(raw.lastUsedStep, undefined);
        assert.equal(typeof item.recoveryCodesLeft, "number");
      }
      // Le COMPTE, lui, est exposé (c'est l'info d'exploitation : qui n'a plus
      // de code de secours et se verrouillera au prochain changement d'appareil).
      const consumed = page.items.find((e) => e.userId === "u-00");
      assert.equal(consumed?.recoveryCodesLeft, 0);
      const intact = page.items.find((e) => e.userId === "u-01");
      assert.equal(intact?.recoveryCodesLeft, 8);
    });

    it("porte les paramètres cryptographiques (algorithme, digits, période)", async () => {
      const page = await store().listPage({ limit: 1 });
      assert.equal(page.items[0].algorithm, "SHA1");
      assert.equal(page.items[0].digits, 6);
      assert.equal(page.items[0].period, 30);
    });
  });
}
