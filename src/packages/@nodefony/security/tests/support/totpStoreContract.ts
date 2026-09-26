import assert from "node:assert/strict";
import type { ITotpSecret } from "../../nodefony/contracts/ITotpSecret";
import type { ITotpSecretStore } from "../../nodefony/contracts/ITotpSecretStore";
import { runTotpPaginationContract } from "./totpPaginationContract";

/**
 * **Banc de contrat UNIQUE** du store de secrets TOTP (`ITotpSecretStore`),
 * au-delà du seul listing. Backend-agnostique : se branche sur n'importe quel
 * store via un harness (Drizzle × sqlite/postgres/mysql, Mongoose × MongoDB).
 * Vit chez le propriétaire du contrat — deux copies divergeraient en silence,
 * chacune passant ses propres tests.
 *
 * Enjeu : le secret TOTP est la **deuxième preuve d'authentification**. Trois
 * propriétés doivent tenir sur tout backend, et chacune, prise en défaut,
 * verrouille un utilisateur hors de son compte ou rouvre une porte fermée :
 *
 * - le **patch partiel** — un champ omis ne doit JAMAIS être écrasé à `null` :
 *   perdre `recoveryCodes` en confirmant un enrôlement retire tout recours ;
 * - l'**anti-rejeu RFC 6238 §5.2** — `lastUsedStep` doit faire l'aller-retour
 *   jusqu'à la base, sinon un code déjà consommé redevient acceptable ;
 * - l'**unicité par utilisateur** — un second secret pour le même compte rendrait
 *   la vérification dépendante de la ligne que le moteur rend en premier.
 *
 * Le banc de **listing** (`runTotpPaginationContract`) est déroulé en dernier :
 * son seed doit survivre aux purges des cas ci-dessus.
 */
export interface TotpStoreContractHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => ITotpSecretStore;
  /** Vide le store (banc idempotent, et base réelle qui survit au run précédent). */
  clear: () => Promise<void>;
  /**
   * **Capacité** : un **nouveau** store sur la même base — prouve que la donnée
   * est persistée, et non retenue par l'instance qui vient de l'écrire. Absente
   * pour un store mémoire (il n'a pas de base) : le cas est alors sauté, et nommé.
   */
  newStore?: () => ITotpSecretStore;
  /**
   * Nombre d'enregistrements portés par cet utilisateur, lu **sous** le store
   * (repository, requête native). C'est la seule façon de prouver l'unicité :
   * l'API publique, elle, ne rend qu'un secret quoi qu'il arrive en base.
   * Absent pour un store mémoire : sa `Map` est indexée par `userId`, l'unicité
   * y est structurelle — il n'y a rien « sous » le store à compter.
   */
  countFor?: (userId: string) => Promise<number>;
  /**
   * **Capacité optionnelle** : réchauffe le pool de connexions. Un pool froid
   * sérialise les premières requêtes et masque les courses que le cas d'écriture
   * concurrente existe pour débusquer.
   */
  warm?: () => Promise<void>;
}

/** Fabrique un secret complet — surcharges par-dessus des défauts sûrs. */
export function makeContractSecret(
  over: Partial<ITotpSecret> = {},
): ITotpSecret {
  return {
    userId: "u1",
    secretEnc: "iv.tag.cipher",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    recoveryCodes: ["h1", "h2"],
    confirmedAt: null,
    lastUsedStep: null,
    createdAt: 1_000_000,
    lastUsedAt: null,
    ...over,
  };
}

/** Messages des promesses rejetées (lisibles dans l'assertion d'échec). */
function rejections(rs: PromiseSettledResult<unknown>[]): string[] {
  return rs
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason?.message);
}

/** Déroule la suite du contrat de store 2FA sur le backend branché. */
export function runTotpStoreContract(harness: TotpStoreContractHarness): void {
  const store = () => harness.store();
  const purge = () => harness.clear();
  const makeSecret = makeContractSecret;

  describe("save / findByUser", () => {
    it("save + findByUser : round-trip complet (JSON, nullables, entiers)", async () => {
      await purge();
      const secret = makeSecret({ userId: "alice", confirmedAt: 42 });
      await store().save(secret);
      const found = await store().findByUser("alice");
      assert.deepEqual(found, secret, "l'objet ressort identique");
      assert.deepEqual(found?.recoveryCodes, ["h1", "h2"]);
      assert.equal(found?.confirmedAt, 42);
      assert.equal(found?.lastUsedStep, null, "absent → null");
      assert.equal(found?.digits, 6);
    });

    it("ne partage pas recoveryCodes avec l'appelant, ni à l'écriture ni à la lecture", async () => {
      // Les codes de secours sont des HASH à usage unique : un appelant qui
      // mute sa copie ne doit ni en rendre un réutilisable, ni en effacer un.
      const recoveryCodes = ["h1", "h2"];
      await store().save(makeSecret({ userId: "u-ref", recoveryCodes }));
      recoveryCodes.push("MUTATED");
      const first = await store().findByUser("u-ref");
      assert.deepEqual(
        first?.recoveryCodes,
        ["h1", "h2"],
        "copie à l'écriture",
      );
      assert.ok(first);
      // `readonly` ne protège qu'à la compilation : un appelant JS (ou un cast)
      // mute quand même à l'exécution — c'est ce que la copie doit absorber.
      const mutable = first as unknown as {
        recoveryCodes: string[];
        lastUsedStep: number | null;
      };
      mutable.recoveryCodes.pop();
      mutable.lastUsedStep = 999;
      const again = await store().findByUser("u-ref");
      assert.deepEqual(
        again?.recoveryCodes,
        ["h1", "h2"],
        "copie à la lecture",
      );
      assert.equal(again?.lastUsedStep, null, "l'anti-rejeu ne bouge pas seul");
    });

    it("findByUser d'un utilisateur non enrôlé renvoie null", async () => {
      assert.equal(await store().findByUser("ghost"), null);
    });

    it("save écrase le secret existant (ré-enrôlement), 1 seul enregistrement par user", async () => {
      await store().save(makeSecret({ userId: "bob", secretEnc: "old" }));
      await store().save(
        makeSecret({ userId: "bob", secretEnc: "new", digits: 8 }),
      );
      const found = await store().findByUser("bob");
      assert.equal(found?.secretEnc, "new");
      assert.equal(found?.digits, 8);
      if (harness.countFor) {
        assert.equal(
          await harness.countFor("bob"),
          1,
          "clé = userId : jamais deux secrets pour un user",
        );
      }
    });

    it("save CONCURRENT × 10 du même user : 0 rejet, un seul secret", async () => {
      // Double-clic / onglet dupliqué sur l'enrôlement 2FA. Un `findOne`
      // d'existence suivi d'un insert laisserait deux écritures voir « absent »
      // → le perdant se ferait rejeter par la contrainte d'unicité.
      await harness.warm?.();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store().save(makeSecret({ userId: "carol", secretEnc: `enc-${i}` })),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      const found = await store().findByUser("carol");
      assert.ok(found && /^enc-\d$/.test(found.secretEnc));
      if (harness.countFor) {
        assert.equal(await harness.countFor("carol"), 1);
      }
    });

    it("les secrets sont ISOLÉS par user", async () => {
      await purge();
      await store().save(makeSecret({ userId: "iso-a", secretEnc: "A" }));
      await store().save(makeSecret({ userId: "iso-b", secretEnc: "B" }));
      assert.equal((await store().findByUser("iso-a"))?.secretEnc, "A");
      assert.equal((await store().findByUser("iso-b"))?.secretEnc, "B");
    });

    it("round-trip de valeurs hostiles : 10 codes, unicode, secretEnc opaque", async () => {
      await purge();
      const recoveryCodes = Array.from(
        { length: 10 },
        (_, i) => `code-${i}-é👩‍💻`,
      );
      await store().save(
        makeSecret({
          userId: "uni",
          recoveryCodes,
          secretEnc: "gcm1.iv+/=.tag",
        }),
      );
      const found = await store().findByUser("uni");
      assert.deepEqual(found?.recoveryCodes, recoveryCodes, "ordre + unicode");
      assert.equal(found?.secretEnc, "gcm1.iv+/=.tag", "blob chiffré intact");
    });
  });

  describe("update (patch partiel)", () => {
    it("ne touche QUE les champs présents — un champ omis n'est JAMAIS écrasé à null", async () => {
      // La propriété critique : perdre `recoveryCodes` en confirmant l'enrôlement
      // verrouillerait le compte hors de tout recours.
      await purge();
      await store().save(makeSecret({ userId: "p1" }));
      await store().update("p1", { confirmedAt: 999 });
      const after = await store().findByUser("p1");
      assert.equal(after?.confirmedAt, 999);
      assert.deepEqual(after?.recoveryCodes, ["h1", "h2"], "codes PRÉSERVÉS");
      assert.equal(after?.secretEnc, "iv.tag.cipher", "secret PRÉSERVÉ");
      assert.equal(after?.lastUsedStep, null);
    });

    it("anti-rejeu RFC 6238 : lastUsedStep avancé, le reste intact", async () => {
      await store().update("p1", {
        lastUsedStep: 57_000_000,
        lastUsedAt: 1_700_000,
      });
      const after = await store().findByUser("p1");
      assert.equal(after?.lastUsedStep, 57_000_000);
      assert.equal(after?.lastUsedAt, 1_700_000);
      assert.equal(after?.confirmedAt, 999, "confirmation PRÉSERVÉE");
      assert.deepEqual(after?.recoveryCodes, ["h1", "h2"]);
    });

    it("consommation d'un code de récupération (recoveryCodes remplacés)", async () => {
      await store().update("p1", { recoveryCodes: ["h2"] });
      const after = await store().findByUser("p1");
      assert.deepEqual(after?.recoveryCodes, ["h2"]);
      assert.equal(after?.lastUsedStep, 57_000_000, "anti-rejeu PRÉSERVÉ");
    });

    it("tous les codes consommés → tableau VIDE (≠ null, ≠ absent)", async () => {
      // `[]` doit survivre au round-trip : le confondre avec `null` ferait
      // croire à des codes disponibles.
      await store().update("p1", { recoveryCodes: [] });
      const after = await store().findByUser("p1");
      assert.deepEqual(after?.recoveryCodes, [], "tableau vide, pas null");
    });

    it("patch vide → no-op (aucune écriture)", async () => {
      const before = await store().findByUser("p1");
      await store().update("p1", {});
      assert.deepEqual(await store().findByUser("p1"), before);
    });

    it("no-op si l'utilisateur est inconnu (ne lève pas, ne crée rien)", async () => {
      await store().update("ghost", { confirmedAt: 1 });
      assert.equal(await store().findByUser("ghost"), null);
    });

    it("epoch ms RÉALISTE (13 chiffres) : pas de troncature", async () => {
      // Un entier 32 bits signé déborde en 2038 : un horodatage tronqué ferait
      // reculer `lastUsedAt` sans qu'aucune erreur ne soit levée.
      const reel = 1_775_000_000_123;
      await store().update("p1", { lastUsedAt: reel });
      assert.equal((await store().findByUser("p1"))?.lastUsedAt, reel);
    });

    it("tranche T RÉALISTE à period=1 : pas de troncature 32 bits", async () => {
      // `T = floor(epochSeconds / period)` ; à `period` = 1 la tranche VAUT
      // l'horodatage Unix, qui dépasse l'entier 32 bits signé en 2038 —
      // l'anti-rejeu cesserait alors de retenir, en silence.
      const tranche = 2_150_000_000;
      await store().update("p1", { lastUsedStep: tranche });
      assert.equal((await store().findByUser("p1"))?.lastUsedStep, tranche);
    });
  });

  describe("delete", () => {
    it("supprime le secret (désactivation 2FA)", async () => {
      await purge();
      await store().save(makeSecret({ userId: "d1" }));
      await store().delete("d1");
      assert.equal(await store().findByUser("d1"), null);
    });

    it("est idempotent sur un utilisateur inconnu", async () => {
      await store().delete("jamais-vu"); // ne jette pas
      await store().delete("d1"); // déjà supprimé
    });

    it("ne supprime QUE le user visé", async () => {
      await purge();
      await store().save(makeSecret({ userId: "keep" }));
      await store().save(makeSecret({ userId: "drop" }));
      await store().delete("drop");
      assert.ok(await store().findByUser("keep"), "le voisin est intact");
      assert.equal(await store().findByUser("drop"), null);
    });
  });

  describe("🔒 ce qui ne doit JAMAIS sortir du store", () => {
    it("listPage n'expose ni le secret chiffré ni les condensats de récupération", async () => {
      // La garantie porte sur ce qui SORT : `ITotpEnrollmentSummary` ne PEUT
      // pas porter ces champs, quel que soit le backend et même si un appelant
      // les demandait. `secretEnc` est réversible (il génèrerait les codes de la
      // victime) ; les condensats sont de la matière à attaque hors ligne.
      await purge();
      await store().save(
        makeSecret({
          userId: "u-secret",
          secretEnc: "gcm1.TRES.SECRET",
          recoveryCodes: ["cond1", "cond2"],
          confirmedAt: 1_000_000,
        }),
      );
      const page = await store().listPage({ limit: 10 });
      const [item] = page.items;
      assert.equal(item.userId, "u-secret");
      assert.ok(!("secretEnc" in item), "secretEnc ne doit pas être exposé");
      assert.ok(
        !("recoveryCodes" in item),
        "les condensats ne doivent pas être exposés",
      );
      // Le NOMBRE, lui, est l'information d'exploitation (qui se verrouillera
      // au prochain changement d'appareil).
      assert.equal(item.recoveryCodesLeft, 2);
      // Et rien ne fuit non plus par la sérialisation de la page entière.
      const serialise = JSON.stringify(page);
      assert.ok(!serialise.includes("TRES.SECRET"));
      assert.ok(!serialise.includes("cond1"));
    });
  });

  describe("persistance", () => {
    it.skipIf(!harness.newStore)(
      "un secret écrit est relu par un NOUVEAU store sur la même base",
      async () => {
        await purge();
        await store().save(
          makeSecret({ userId: "persist", secretEnc: "durable" }),
        );
        const other = harness.newStore!();
        assert.equal((await other.findByUser("persist"))?.secretEnc, "durable");
      },
    );
  });

  describe("recherche `q` — préfixe indexable, terme échappé", () => {
    // Ce comportement vit au socle (`searchCriteria`) ; ce banc est ce qui rend
    // l'extraction vérifiable, et il le rejoue sur chaque moteur — l'échappement
    // du motif de recherche est précisément ce qui diverge entre eux.
    it("filtre sur le PRÉFIXE de l'identifiant, pas sur une sous-chaîne", async () => {
      await purge();
      for (const userId of ["alice", "alicia", "bob", "malice"]) {
        await store().save(makeSecret({ userId }));
      }
      const page = await store().listPage({ limit: 50, q: "ali" });
      const ids = page.items.map((i) => i.userId).sort();
      // `malice` CONTIENT « ali » mais ne COMMENCE pas par lui : l'ancrage à
      // gauche est ce qui rend la recherche indexable, et il doit se voir.
      assert.deepEqual(ids, ["alice", "alicia"]);
    });

    it("un terme vide ne filtre RIEN (ce n'est pas une recherche)", async () => {
      await purge();
      await store().save(makeSecret({ userId: "u1" }));
      await store().save(makeSecret({ userId: "u2" }));
      const page = await store().listPage({ limit: 50, q: "" });
      assert.equal(page.items.length, 2);
    });

    it("un `_` SAISI se cherche lui-même — il n'élargit pas la recherche", async () => {
      await purge();
      for (const userId of ["a_c", "abc"]) {
        await store().save(makeSecret({ userId }));
      }
      // Un terme saisi dans une console n'est ni un motif SQL ni une expression
      // régulière : `_` doit se chercher lui-même, quel que soit le moteur.
      const page = await store().listPage({ limit: 50, q: "a_c" });
      assert.deepEqual(
        page.items.map((i) => i.userId),
        ["a_c"],
      );
    });

    it("un `%` SAISI se cherche lui-même", async () => {
      await purge();
      for (const userId of ["a%c", "axc"]) {
        await store().save(makeSecret({ userId }));
      }
      const page = await store().listPage({ limit: 50, q: "a%c" });
      assert.deepEqual(
        page.items.map((i) => i.userId),
        ["a%c"],
      );
    });
  });

  // Standard de pagination : LE banc de listing du contrat, déroulé sur le même
  // backend. Déclaré en DERNIER — son seed doit survivre aux purges ci-dessus.
  runTotpPaginationContract({
    store: () => harness.store(),
    clear: () => harness.clear(),
  });
}
