import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { ITotpSecret } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTotpSecretStore } from "../../nodefony/src/DrizzleTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "../../nodefony/entity/totpSecretEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runTotpPaginationContract } from "../../../security/tests/support/totpPaginationContract";

/**
 * BANC DE PARITÉ DU CONTRAT `ITotpSecretStore` — LA même suite sur les TROIS
 * dialectes (sqlite toujours ; postgres/mysql gatés par l'infra).
 *
 * Enjeu : le secret TOTP est la 2ᵉ preuve d'authentification. Deux propriétés
 * doivent tenir sur tout backend — le **patch partiel** (un champ omis ne doit
 * JAMAIS être écrasé à NULL : perdre `recoveryCodes` verrouillerait le compte)
 * et l'**anti-rejeu RFC 6238** (`lastUsedStep` ne doit pas régresser, sinon un
 * code déjà consommé redevient acceptable).
 */

export interface ITotpStoreContractOptions {
  dialect: SqlDialect;
  connector: string;
  connection: { filename?: string; url?: string };
}

export function runTotpStoreContract(opts: ITotpStoreContractOptions): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let store: DrizzleTotpSecretStore;

  const makeSecret = (over: Partial<ITotpSecret> = {}): ITotpSecret => ({
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
  });

  const rejections = (rs: PromiseSettledResult<unknown>[]): string[] =>
    rs
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason?.message);

  /** Cf `token-store-contract` : un pool froid masque les races. */
  const warmPool = async (n = 10): Promise<void> => {
    const repo = orm.getRepository(TOTP_SECRET_ENTITY);
    await Promise.all(Array.from({ length: n }, () => repo.count({})));
  };

  const purge = async (): Promise<void> => {
    await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
  };

  beforeAll(async () => {
    registerTotpSecretEntity(connector, dialect); // AVANT connect
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    store = DrizzleTotpSecretStore.from(orm);
    await purge();
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister(TOTP_SECRET_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  describe("save / findByUser", () => {
    it("save + findByUser : round-trip complet (JSON, nullables, entiers)", async () => {
      await purge();
      const secret = makeSecret({ userId: "alice", confirmedAt: 42 });
      await store.save(secret);
      const found = await store.findByUser("alice");
      assert.deepEqual(found, secret, "l'objet ressort identique");
      assert.deepEqual(found?.recoveryCodes, ["h1", "h2"]);
      assert.equal(found?.confirmedAt, 42);
      assert.equal(found?.lastUsedStep, null, "NULL → null");
      assert.equal(found?.digits, 6);
    });

    it("findByUser d'un utilisateur non enrôlé renvoie null", async () => {
      assert.equal(await store.findByUser("ghost"), null);
    });

    it("save écrase le secret existant (ré-enrôlement), 1 seule ligne par user", async () => {
      await store.save(makeSecret({ userId: "bob", secretEnc: "old" }));
      await store.save(
        makeSecret({ userId: "bob", secretEnc: "new", digits: 8 }),
      );
      const found = await store.findByUser("bob");
      assert.equal(found?.secretEnc, "new");
      assert.equal(found?.digits, 8);
      assert.equal(
        await orm.getRepository(TOTP_SECRET_ENTITY).count({ userId: "bob" }),
        1,
        "PK userId : jamais deux secrets pour un user",
      );
    });

    it("save CONCURRENT × 10 du même user : 0 rejet, un seul secret", async () => {
      // Double-clic / onglet dupliqué sur l'enrôlement 2FA.
      await warmPool();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store.save(makeSecret({ userId: "carol", secretEnc: `enc-${i}` })),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      const found = await store.findByUser("carol");
      assert.ok(found && /^enc-\d$/.test(found.secretEnc));
    });

    it("les secrets sont ISOLÉS par user", async () => {
      await purge();
      await store.save(makeSecret({ userId: "iso-a", secretEnc: "A" }));
      await store.save(makeSecret({ userId: "iso-b", secretEnc: "B" }));
      assert.equal((await store.findByUser("iso-a"))?.secretEnc, "A");
      assert.equal((await store.findByUser("iso-b"))?.secretEnc, "B");
    });

    it("round-trip de valeurs hostiles : 10 codes, unicode, secretEnc opaque", async () => {
      await purge();
      const recoveryCodes = Array.from(
        { length: 10 },
        (_, i) => `code-${i}-é👩‍💻`,
      );
      await store.save(
        makeSecret({
          userId: "uni",
          recoveryCodes,
          secretEnc: "gcm1.iv+/=.tag",
        }),
      );
      const found = await store.findByUser("uni");
      assert.deepEqual(found?.recoveryCodes, recoveryCodes, "ordre + unicode");
      assert.equal(found?.secretEnc, "gcm1.iv+/=.tag", "blob chiffré intact");
    });
  });

  describe("update (patch partiel)", () => {
    it("ne touche QUE les champs présents — un champ omis n'est JAMAIS écrasé à NULL", async () => {
      // La propriété critique : perdre `recoveryCodes` en confirmant l'enrôlement
      // verrouillerait le compte hors de tout recours.
      await purge();
      await store.save(makeSecret({ userId: "p1" }));
      await store.update("p1", { confirmedAt: 999 });
      const after = await store.findByUser("p1");
      assert.equal(after?.confirmedAt, 999);
      assert.deepEqual(after?.recoveryCodes, ["h1", "h2"], "codes PRÉSERVÉS");
      assert.equal(after?.secretEnc, "iv.tag.cipher", "secret PRÉSERVÉ");
      assert.equal(after?.lastUsedStep, null);
    });

    it("anti-rejeu RFC 6238 : lastUsedStep avancé, le reste intact", async () => {
      await store.update("p1", {
        lastUsedStep: 57_000_000,
        lastUsedAt: 1_700_000,
      });
      const after = await store.findByUser("p1");
      assert.equal(after?.lastUsedStep, 57_000_000);
      assert.equal(after?.lastUsedAt, 1_700_000);
      assert.equal(after?.confirmedAt, 999, "confirmation PRÉSERVÉE");
      assert.deepEqual(after?.recoveryCodes, ["h1", "h2"]);
    });

    it("consommation d'un code de récupération (recoveryCodes remplacés)", async () => {
      await store.update("p1", { recoveryCodes: ["h2"] });
      const after = await store.findByUser("p1");
      assert.deepEqual(after?.recoveryCodes, ["h2"]);
      assert.equal(after?.lastUsedStep, 57_000_000, "anti-rejeu PRÉSERVÉ");
    });

    it("tous les codes consommés → tableau VIDE (≠ null, ≠ absent)", async () => {
      // `[]` doit survivre au round-trip JSON : le confondre avec NULL ferait
      // croire à des codes disponibles.
      await store.update("p1", { recoveryCodes: [] });
      const after = await store.findByUser("p1");
      assert.deepEqual(after?.recoveryCodes, [], "tableau vide, pas null");
    });

    it("patch vide → no-op (aucune écriture)", async () => {
      const before = await store.findByUser("p1");
      await store.update("p1", {});
      assert.deepEqual(await store.findByUser("p1"), before);
    });

    it("no-op si l'utilisateur est inconnu (ne lève pas, ne crée rien)", async () => {
      await store.update("ghost", { confirmedAt: 1 });
      assert.equal(await store.findByUser("ghost"), null);
    });

    it("epoch ms RÉALISTE (13 chiffres) : pas de troncature", async () => {
      const reel = 1_775_000_000_123;
      await store.update("p1", { lastUsedAt: reel });
      assert.equal((await store.findByUser("p1"))?.lastUsedAt, reel);
    });
  });

  describe("delete", () => {
    it("supprime le secret (désactivation 2FA)", async () => {
      await purge();
      await store.save(makeSecret({ userId: "d1" }));
      await store.delete("d1");
      assert.equal(await store.findByUser("d1"), null);
    });

    it("est idempotent sur un utilisateur inconnu", async () => {
      await store.delete("jamais-vu"); // ne jette pas
      await store.delete("d1"); // déjà supprimé
    });

    it("ne supprime QUE le user visé", async () => {
      await purge();
      await store.save(makeSecret({ userId: "keep" }));
      await store.save(makeSecret({ userId: "drop" }));
      await store.delete("drop");
      assert.ok(await store.findByUser("keep"), "le voisin est intact");
      assert.equal(await store.findByUser("drop"), null);
    });
  });

  describe("persistance", () => {
    it("un secret écrit est relu par un NOUVEAU store sur le même ORM", async () => {
      await purge();
      await store.save(makeSecret({ userId: "persist", secretEnc: "durable" }));
      const other = DrizzleTotpSecretStore.from(orm);
      assert.equal((await other.findByUser("persist"))?.secretEnc, "durable");
    });
  });

  describe("recherche `q` — préfixe indexable, terme échappé", () => {
    // Ce comportement n'était couvert par AUCUN test, sur aucun dialecte, alors
    // qu'il est écrit deux fois dans le dépôt (ici et dans le store WebAuthn).
    // Il vit désormais au socle (`searchCriteria`) ; ce banc est ce qui rend
    // l'extraction vérifiable, et il le rejoue sur les trois dialectes — le
    // `LIKE` et son échappement sont précisément ce qui diverge entre moteurs.
    it("filtre sur le PRÉFIXE de l'identifiant, pas sur une sous-chaîne", async () => {
      await purge();
      for (const userId of ["alice", "alicia", "bob", "malice"]) {
        await store.save(makeSecret({ userId }));
      }
      const page = await store.listPage({ limit: 50, q: "ali" });
      const ids = page.items.map((i) => i.userId).sort();
      // `malice` CONTIENT « ali » mais ne COMMENCE pas par lui : l'ancrage à
      // gauche est ce qui rend la recherche indexable, et il doit se voir.
      assert.deepEqual(ids, ["alice", "alicia"]);
    });

    it("un terme vide ne filtre RIEN (ce n'est pas une recherche)", async () => {
      await purge();
      await store.save(makeSecret({ userId: "u1" }));
      await store.save(makeSecret({ userId: "u2" }));
      const page = await store.listPage({ limit: 50, q: "" });
      assert.equal(page.items.length, 2);
    });

    it("un `_` SAISI se cherche lui-même — il n'élargit plus la recherche", async () => {
      await purge();
      for (const userId of ["a_c", "abc"]) {
        await store.save(makeSecret({ userId }));
      }
      // Ce test verrouillait l'inverse, et le disait : `_` élargissait au lieu
      // de restreindre, faute de clause `LIKE … ESCAPE '\'` émise — sans elle un
      // terme échappé était cherché littéralement et ne rendait plus rien. La
      // clause est désormais posée par l'adapter, donc `searchCriteria` échappe
      // le terme, et la réponse est enfin celle qu'on lit dans la barre.
      const page = await store.listPage({ limit: 50, q: "a_c" });
      assert.deepEqual(
        page.items.map((i) => i.userId),
        ["a_c"],
      );
    });
  });

  // Standard de pagination : LE banc du propriétaire du contrat
  // (`@nodefony/security`), déroulé ici sur le backend SQL du dialecte courant.
  // Déclaré en DERNIER : son seed doit survivre aux `purge()` des tests ci-dessus.
  runTotpPaginationContract({
    store: () => store,
    clear: purge,
  });
}
