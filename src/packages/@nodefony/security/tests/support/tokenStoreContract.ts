import assert from "node:assert/strict";
import type { IAccessTokenRecord, ITokenStore } from "../../index";

/**
 * **Banc de contrat UNIQUE** du store de jetons (`ITokenStore`). Backend-agnostique :
 * se branche sur n'importe quel store via un harness (mémoire, Drizzle ×
 * sqlite/postgres/mysql, Mongoose × MongoDB). Vit chez le propriétaire du
 * contrat — deux copies divergeraient en silence, chacune passant ses propres
 * tests.
 *
 * **Pourquoi ce banc existe** : le store de jetons est la brique de sécurité la
 * plus exposée (PAT, refresh, denylist, seuils de révocation), et ses chemins
 * d'exécution divergent radicalement par dialecte — `upsert` = `ON CONFLICT`
 * (sqlite/pg) vs `ON DUPLICATE KEY UPDATE` + relecture (mysql, sans RETURNING) ;
 * `$max` = `MAX()` vs `GREATEST()` ; epoch ms = `integer` vs `bigint` ; JSON =
 * `text` vs `jsonb` vs `json`. Avant ce banc, ces stores n'étaient prouvés bout
 * en bout QUE sur postgres : « tous les dialectes » ne valait que pour le
 * contrat `IRepository`, pas pour les stores. Un écart observé ici est un bug du
 * framework, par construction.
 *
 * **Divergences ASSUMÉES (hors banc, testées à côté)** : l'ORDRE d'arbitrage de
 * deux écritures concurrentes n'est pas un invariant portable (sqlite = connexion
 * unique + microtasks FIFO → le 1ᵉʳ lancé gagne ; pg/mysql = pool → l'ordre
 * d'arrivée au SGBD est libre). Le banc n'exige donc que ce qui est vrai
 * PARTOUT : aucun rejet, une seule révocation effective, et aucune réécriture
 * ultérieure. Le cas « le 1ᵉʳ lancé gagne » vit dans le fichier sqlite.
 */

/** Branchement d'un backend sur le banc. */
export interface TokenStoreContractHarness {
  /**
   * Fabrique le store sous test, avec l'horloge et la rétention du banc.
   * Appelée paresseusement (APRÈS les `beforeAll` du backend), puis de nouveau
   * après chaque `clear` : un store persistant se re-fabrique sans état, un
   * store mémoire repart vierge.
   */
  create: (now: () => number, retentionRevokedMs: number) => ITokenStore;
  /**
   * Vide la base sous le store (banc idempotent, et base réelle qui survit au
   * run précédent). Sans objet pour un store mémoire : la re-fabrication suffit.
   */
  clear?: () => Promise<void>;
  /**
   * **Capacité optionnelle** : réchauffe le pool AVANT un test de concurrence.
   * Sans ça, sur un pool les connexions s'ouvrent à la demande : le 1ᵉʳ
   * écrivain (seul à en tenir une chaude) boucle son aller-retour pendant que
   * les autres attendent leur TCP+auth, ils lisent tous APRÈS lui, et la course
   * ne se produit JAMAIS — le test devient un faux négatif.
   */
  warm?: () => Promise<void>;
  /**
   * **Capacité** : l'expiration est portée par le TTL du MOTEUR (Redis). `gc()`
   * n'a alors rien à balayer et rend 0 : le banc vérifie que l'expiré a
   * DISPARU plutôt qu'un compte. Le TTL se compte à la seconde (1 s minimum) :
   * le banc avance l'horloge d'une seconde pour le laisser tomber, et saute —
   * en le nommant — la borne exacte à la milliseconde.
   */
  nativeTtl?: boolean;
  /**
   * **Capacité** : l'expiration suit l'horloge injectée du banc. `false` sur un
   * serveur réel à TTL natif, dont on n'avance pas le temps : les cas
   * d'expiration sont alors sautés, et nommés. Défaut `true`.
   */
  clockDrivenExpiry?: boolean;
}

const RETENTION_MS = 30 * 24 * 3_600_000;

/** Messages des promesses rejetées (assertion lisible : `[]` = aucun rejet). */
function rejections(rs: PromiseSettledResult<unknown>[]): string[] {
  return rs
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason?.message);
}

/**
 * Déroule la suite du contrat de store de jetons sur le backend branché. À
 * appeler DANS un `describe` (éventuellement `describe.skipIf(!url)`).
 */
export function runTokenStoreContract(
  harness: TokenStoreContractHarness,
): void {
  /** Horloge contrôlée (epoch ms) → tests déterministes (rétention, expiration). */
  let CLOCK = 1_000_000;
  const now = (): number => CLOCK;
  let instance: ITokenStore | null = null;
  const store = (): ITokenStore =>
    (instance ??= harness.create(now, RETENTION_MS));
  const purge = async (): Promise<void> => {
    await harness.clear?.();
    instance = null;
  };
  const nativeTtl = harness.nativeTtl === true;
  const clockExpiry = harness.clockDrivenExpiry !== false;
  /** Ce que `gc()` doit compter : rien quand le moteur expire seul. */
  const purgedBy = (n: number): number => (nativeTtl ? 0 : n);
  /** Laisse tomber un TTL natif (à la seconde, 1 s minimum) ; no-op sinon. */
  const letTtlElapse = (): void => {
    if (nativeTtl) CLOCK += 1_000;
  };

  beforeAll(async () => {
    CLOCK = 1_000_000;
    await purge();
  });

  /** Construit un `IAccessTokenRecord` complet (24 champs) avec surcharges. */
  const makeRecord = (
    over: Partial<IAccessTokenRecord> & Pick<IAccessTokenRecord, "id">,
  ): IAccessTokenRecord => ({
    kind: "pat",
    name: "test",
    prefix: null,
    subjectId: "u1",
    subjectType: "user",
    tenantId: null,
    scopes: [],
    audience: [],
    resources: null,
    secretHash: `hash-${over.id}`,
    hashAlg: "sha256",
    clientId: null,
    cnf: null,
    family: null,
    replacedBy: null,
    createdAt: CLOCK,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
    ...over,
  });

  // ── Records : put / lookups ─────────────────────────────────────────────────
  describe("records (put / find)", () => {
    it("put + findById : round-trip complet (JSON, epoch ms exact, NULL → null)", async () => {
      CLOCK = 1_000_000;
      const record = makeRecord({
        id: "t1",
        scopes: ["orders:read", "orders:write"],
        audience: ["api"],
        metadata: { ci: true, n: 1 },
        expiresAt: CLOCK + 60_000,
      });
      await store().put(record);
      const r = await store().findById("t1");
      assert.ok(r);
      // Égalité STRUCTURELLE : un champ ajouté, perdu ou retypé par un
      // backend (colonne en trop, `_id` qui fuit, `undefined` pour `null`)
      // fait tomber ce cas.
      assert.deepEqual(r, record);
      // JSON : `text mode:json` sqlite / `jsonb` pg / `json` mysql (MariaDB rend
      // une string → customType) — le contrat rend l'objet, partout.
      assert.deepEqual(r.scopes, ["orders:read", "orders:write"]);
      assert.deepEqual(r.audience, ["api"]);
      assert.deepEqual(r.metadata, { ci: true, n: 1 });
      // epoch ms : `integer` sqlite / `bigint mode:number` pg+mysql → number exact.
      assert.equal(r.createdAt, 1_000_000);
      assert.equal(r.expiresAt, 1_060_000);
      assert.equal(r.revokedAt, null, "NULL → null");
      assert.equal(r.kind, "pat");
    });

    it("ne partage pas scopes/metadata avec l'appelant, ni à l'écriture ni à la lecture", async () => {
      const scopes = ["a"];
      const metadata: Record<string, unknown> = { k: 1 };
      await store().put(
        makeRecord({ id: "t-ref", subjectId: "u-ref", scopes, metadata }),
      );
      scopes.push("MUTATED");
      metadata.k = 999;
      const first = await store().findById("t-ref");
      assert.deepEqual(first?.scopes, ["a"], "copie à l'écriture");
      assert.deepEqual(first?.metadata, { k: 1 }, "copie à l'écriture");
      assert.ok(first);
      // `readonly` ne protège qu'à la compilation : un appelant JS (ou un cast)
      // mute quand même à l'exécution — c'est ce que la copie doit absorber.
      const mutable = first as unknown as {
        scopes: string[];
        metadata: Record<string, unknown>;
        revokedAt: number | null;
      };
      mutable.scopes.push("MUTATED");
      mutable.metadata.k = 999;
      mutable.revokedAt = 1;
      const again = await store().findById("t-ref");
      assert.deepEqual(again?.scopes, ["a"], "copie à la lecture");
      assert.deepEqual(again?.metadata, { k: 1 }, "copie à la lecture");
      assert.equal(
        again?.revokedAt,
        null,
        "un jeton lu ne se révoque pas seul",
      );
    });

    it("findByHash retrouve par hash de secret (colonne UNIQUE)", async () => {
      const r = await store().findByHash("hash-t1");
      assert.equal(r?.id, "t1");
      assert.equal(await store().findByHash("inconnu"), null);
    });

    it("put sur le même id met à jour sans doublon (upsert)", async () => {
      await store().put(makeRecord({ id: "t1", name: "renommé" }));
      const all = await store().findBySubject("u1");
      assert.equal(all.length, 1);
      assert.equal(all[0].name, "renommé");
    });

    it("put CONCURRENT × 10 d'un record EXISTANT (rotation rejouée) : 0 rejet, 1 ligne", async () => {
      // Le cas réel : la rotation d'un refresh réécrit l'ANCIEN record, et un
      // client qui rejoue son refresh en déclenche plusieurs à la fois.
      //
      // Le cas « ligne absente » n'est PAS testé, délibérément : il n'est pas
      // atteignable (les 3 appelants posent un id généré) et il DIVERGE entre
      // dialectes — `access_token` a DEUX uniques (`id` PK + `secretHash`) or un
      // `ON CONFLICT` n'arbitre qu'UN index : pg lève (23505 sur secretHash),
      // sqlite passe. Cf la limite documentée sur `DrizzleTokenStore.put`.
      await harness.warm?.();
      const base = makeRecord({ id: "conc-1", subjectId: "u-conc" });
      await store().put(base); // la ligne préexiste
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store().put({ ...base, name: `writer-${i}` }),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      const all = await store().findBySubject("u-conc");
      assert.equal(all.length, 1, "une seule ligne pour la PK");
      assert.ok(
        /^writer-\d$/.test(all[0].name),
        "la ligne porte l'un des écrits",
      );
    });

    it("re-put du MÊME id avec un autre secret/porteur/famille : les anciens liens disparaissent", async () => {
      // Une ligne par id : l'ancien hash ne doit PLUS authentifier, l'ancien
      // porteur ne doit plus lister le jeton, l'ancienne famille ne doit plus
      // le révoquer. Un index qui garde l'ancien lien rouvre un secret retiré.
      await store().put(
        makeRecord({
          id: "t-move",
          secretHash: "hash-avant",
          subjectId: "u-avant",
          kind: "refresh",
          family: "fam-avant",
        }),
      );
      await store().put(
        makeRecord({
          id: "t-move",
          secretHash: "hash-apres",
          subjectId: "u-apres",
          kind: "refresh",
          family: "fam-apres",
        }),
      );
      assert.equal(
        await store().findByHash("hash-avant"),
        null,
        "l'ancien secret n'authentifie plus",
      );
      assert.equal((await store().findByHash("hash-apres"))?.id, "t-move");
      assert.deepEqual(await store().findBySubject("u-avant"), []);
      await store().revokeFamily("fam-avant", "reuse_detected");
      assert.equal(
        (await store().findById("t-move"))?.revokedAt,
        null,
        "l'ancienne famille n'atteint plus le jeton",
      );
    });

    it("findById renvoie null pour un id inconnu", async () => {
      assert.equal(await store().findById("nope"), null);
    });

    it("markUsed pose lastUsedAt/ip/ua ; no-op si id inconnu", async () => {
      await store().markUsed("t1", {
        at: 1234,
        ip: "10.0.0.1",
        userAgent: "ua",
      });
      const r = await store().findById("t1");
      assert.equal(r?.lastUsedAt, 1234);
      assert.equal(r?.lastUsedIp, "10.0.0.1");
      assert.equal(r?.lastUsedUserAgent, "ua");
      await store().markUsed("nope", { at: 1 }); // ne jette pas
    });

    it("markUsed : ip/ua omis → NULL (pas `undefined` ni la valeur précédente)", async () => {
      await store().markUsed("t1", { at: 5678 });
      const r = await store().findById("t1");
      assert.equal(r?.lastUsedAt, 5678);
      assert.equal(r?.lastUsedIp, null, "l'ancienne ip ne colle pas");
      assert.equal(r?.lastUsedUserAgent, null);
    });

    it("findBySubject : tous les jetons du porteur, et rien des autres", async () => {
      await purge();
      await store().put(makeRecord({ id: "s1", subjectId: "alice" }));
      await store().put(makeRecord({ id: "s2", subjectId: "alice" }));
      await store().put(makeRecord({ id: "s3", subjectId: "bob" }));
      const alice = await store().findBySubject("alice");
      assert.deepEqual(alice.map((r) => r.id).sort(), ["s1", "s2"]);
      assert.equal((await store().findBySubject("nobody")).length, 0);
    });

    it("listAll : vue d'admin cross-porteur (PAT + refresh)", async () => {
      const all = await store().listAll();
      assert.deepEqual(all.map((r) => r.id).sort(), ["s1", "s2", "s3"]);
    });

    it("secretHash reste UNIQUE en base : JAMAIS deux jetons pour un même secret", async () => {
      // Invariant de SÉCURITÉ, jamais vérifié jusqu'ici : `findByHash` sert à
      // AUTHENTIFIER un porteur — deux records au même hash rendraient un secret
      // ambigu (il authentifierait deux identités, et le lookup deviendrait
      // non déterministe). La contrainte doit tenir dans le SGBD.
      //
      // Seul l'invariant PORTABLE est ici (« il n'existe jamais 2 lignes au même
      // hash »). Le COMMENT diverge et se teste par dialecte (cf fichiers
      // consommateurs) : sqlite/pg REJETTENT (`ON CONFLICT (id)` n'arbitre pas la
      // 2ᵉ unique → 23505) ; mysql ÉCRASE la ligne en conflit (`ON DUPLICATE KEY
      // UPDATE` sans `target` arbitre TOUTES les uniques). Cas inatteignable en
      // pratique — le hash est un sha256 de secret aléatoire — mais gravé.
      await purge();
      await store().put(makeRecord({ id: "h1", secretHash: "collision" }));
      await store()
        .put(makeRecord({ id: "h2", secretHash: "collision" }))
        .catch(() => undefined); // le rejet EST un comportement valide (cf ci-dessus)
      const all = await store().listAll();
      assert.equal(
        all.filter((r) => r.secretHash === "collision").length,
        1,
        "un secret ne désigne jamais deux jetons",
      );
      assert.equal(
        (await store().findByHash("collision"))?.secretHash,
        "collision",
        "le lookup d'authentification reste déterministe",
      );
    });

    it("round-trip de valeurs hostiles : unicode, JSON imbriqué, chaîne vide, gros tableau", async () => {
      // Les colonnes JSON traversent 3 encodages (text sqlite / jsonb pg / json
      // mysql, où MariaDB rend une string → customType). Ce qui entre doit
      // ressortir identique, quel que soit le backend.
      await purge();
      const scopes = Array.from({ length: 50 }, (_, i) => `scope:${i}`);
      const metadata = {
        "clé accentuée": "chloé 👩‍💻",
        nested: { deep: [1, { ok: true }, null] },
        vide: "",
        zero: 0,
        faux: false,
      };
      await store().put(
        makeRecord({
          id: "uni-1",
          name: "jeton « spécial » — 日本語",
          scopes,
          metadata,
        }),
      );
      const r = await store().findById("uni-1");
      assert.equal(r?.name, "jeton « spécial » — 日本語");
      assert.deepEqual(r?.scopes, scopes, "50 entrées, ordre préservé");
      assert.deepEqual(r?.metadata, metadata, "objet imbriqué identique");
    });
  });

  // ── Révocation ──────────────────────────────────────────────────────────────
  describe("révocation", () => {
    it("revoke est idempotent et conserve la 1ʳᵉ date/raison", async () => {
      await store().put(makeRecord({ id: "rev1" }));
      CLOCK = 2_000_000;
      await store().revoke("rev1", "logout");
      const first = await store().findById("rev1");
      assert.equal(first?.revokedAt, 2_000_000);
      assert.equal(first?.revokedReason, "logout");

      CLOCK = 3_000_000;
      await store().revoke("rev1", "manual"); // 2ᵉ appel : ne doit RIEN changer
      const second = await store().findById("rev1");
      assert.equal(second?.revokedAt, 2_000_000);
      assert.equal(second?.revokedReason, "logout");
    });

    it("revoke CONCURRENT : une seule révocation effective, jamais réécrite ensuite", async () => {
      // Invariant PORTABLE : lequel des deux gagne dépend de l'ordre d'arrivée au
      // SGBD (libre sur un pool) → le banc ne l'exige pas. Ce qui vaut PARTOUT :
      // aucun rejet, la révocation est cohérente (date ET raison du MÊME
      // écrivain), et un revoke ULTÉRIEUR ne la réécrit pas — c'est la promesse
      // « conserve la 1ʳᵉ date/raison » qu'un findOne+update violait en silence.
      await harness.warm?.();
      await store().put(makeRecord({ id: "rev-conc" }));
      CLOCK = 7_000_000;
      const results = await Promise.allSettled([
        store().revoke("rev-conc", "logout"),
        store().revoke("rev-conc", "manual"),
      ]);
      assert.deepEqual(rejections(results), [], "aucun rejet");
      const after = await store().findById("rev-conc");
      assert.equal(after?.revokedAt, 7_000_000);
      assert.ok(
        ["logout", "manual"].includes(after?.revokedReason as string),
        "un motif entier, jamais un mélange",
      );
      const winner = after?.revokedReason;

      CLOCK = 8_000_000;
      await store().revoke("rev-conc", "compromised");
      const later = await store().findById("rev-conc");
      assert.equal(later?.revokedAt, 7_000_000, "la 1ʳᵉ date tient");
      assert.equal(later?.revokedReason, winner, "la 1ʳᵉ raison tient");
    });

    it("revokeFamily coupe les membres actifs et préserve les déjà-révoqués", async () => {
      await store().put(
        makeRecord({
          id: "f1",
          kind: "refresh",
          family: "fam",
          revokedAt: 500,
          revokedReason: "rotated",
        }),
      );
      await store().put(
        makeRecord({ id: "f2", kind: "refresh", family: "fam" }),
      );
      CLOCK = 4_000_000;
      await store().revokeFamily("fam", "reuse_detected");

      const rotated = await store().findById("f1");
      assert.equal(rotated?.revokedAt, 500, "membre déjà révoqué : intouché");
      assert.equal(rotated?.revokedReason, "rotated");
      const cut = await store().findById("f2");
      assert.equal(cut?.revokedAt, 4_000_000);
      assert.equal(cut?.revokedReason, "reuse_detected");
    });

    it("revoke / revokeFamily sur une clé INCONNUE : no-op silencieux, jamais une erreur", async () => {
      // Un jeton déjà purgé (gc) peut être révoqué par un logout tardif : le
      // chemin doit rester sans effet, pas lever — sinon un 500 sur un logout.
      await store().revoke("jamais-vu", "logout");
      await store().revokeFamily("famille-fantome", "reuse_detected");
      assert.equal(await store().findById("jamais-vu"), null);
    });

    it("revokeFamily n'atteint QUE sa famille (pas les jetons sans famille)", async () => {
      await purge();
      CLOCK = 4_500_000;
      await store().put(makeRecord({ id: "fa", kind: "refresh", family: "A" }));
      await store().put(makeRecord({ id: "fb", kind: "refresh", family: "B" }));
      await store().put(makeRecord({ id: "fnull" })); // family = null
      await store().revokeFamily("A", "reuse_detected");
      assert.equal((await store().findById("fa"))?.revokedAt, 4_500_000);
      assert.equal(
        (await store().findById("fb"))?.revokedAt,
        null,
        "famille B intacte",
      );
      assert.equal(
        (await store().findById("fnull"))?.revokedAt,
        null,
        "`family` NULL ne matche PAS le critère `family = 'A'`",
      );
    });

    it("revokeFamily CONCURRENT : les déjà-révoqués gardent leur raison d'origine", async () => {
      await harness.warm?.();
      await store().put(
        makeRecord({
          id: "fc1",
          kind: "refresh",
          family: "fam-conc",
          revokedAt: 500,
          revokedReason: "rotated",
        }),
      );
      await store().put(
        makeRecord({ id: "fc2", kind: "refresh", family: "fam-conc" }),
      );
      CLOCK = 9_000_000;
      const results = await Promise.allSettled([
        store().revokeFamily("fam-conc", "reuse_detected"),
        store().revokeFamily("fam-conc", "reuse_detected"),
      ]);
      assert.deepEqual(rejections(results), [], "aucun rejet");
      const rotated = await store().findById("fc1");
      assert.equal(rotated?.revokedAt, 500);
      assert.equal(rotated?.revokedReason, "rotated");
      const cut = await store().findById("fc2");
      assert.equal(cut?.revokedAt, 9_000_000);
      assert.equal(cut?.revokedReason, "reuse_detected");
    });
  });

  // ── Denylist jti ────────────────────────────────────────────────────────────
  describe("denylist jti", () => {
    it("denyJti puis isJtiDenied = true tant que non expiré", async () => {
      CLOCK = 5_000_000;
      await store().denyJti("jti-a", 5_500_000);
      assert.equal(await store().isJtiDenied("jti-a"), true);
    });

    it.skipIf(!clockExpiry)(
      "une entrée expirée n'est plus dénoncée (fenêtre $gt now)",
      async () => {
        CLOCK = 6_000_000; // > 5_500_000
        assert.equal(await store().isJtiDenied("jti-a"), false);
      },
    );

    it("denyJti écrase l'expiration (upsert)", async () => {
      CLOCK = 6_000_000;
      await store().denyJti("jti-a", 7_000_000);
      assert.equal(await store().isJtiDenied("jti-a"), true);
    });

    it("denyJti CONCURRENT × 10 du même jti : 0 rejet (réservation atomique)", async () => {
      // Un jeton rejoué dénoncé plusieurs fois en parallèle ne doit pas faire
      // remonter une violation de PK — donc pas de 500 sur un chemin de sécurité.
      await harness.warm?.();
      CLOCK = 6_000_000;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store().denyJti("jti-conc", 7_000_000 + i),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(await store().isJtiDenied("jti-conc"), true);
    });

    it("isJtiDenied = false pour un jti inconnu", async () => {
      assert.equal(await store().isJtiDenied("jamais"), false);
    });

    it.skipIf(!clockExpiry)(
      "BORNE exacte : à l'instant `expiresAt`, le jti n'est DÉJÀ plus dénoncé ($gt strict)",
      async () => {
        // La fenêtre est `expiresAt > now` : à l'instant PILE de l'expiration, le
        // jeton est libre. Un `>=` ici le dénoncerait une milliseconde de trop —
        // écart invisible en test approximatif, et divergent entre backends si le
        // critère n'était pas porté à l'identique.
        await store().denyJti("jti-borne", 42_000_000);
        CLOCK = 41_999_999;
        assert.equal(
          await store().isJtiDenied("jti-borne"),
          true,
          "1 ms avant : dénoncé",
        );
        CLOCK = 42_000_000;
        assert.equal(
          await store().isJtiDenied("jti-borne"),
          false,
          "à l'instant pile : libre",
        );
      },
    );
  });

  // ── Révocation en masse par porteur ─────────────────────────────────────────
  describe("revokeAllForSubject (seuil monotone)", () => {
    it("pose puis renvoie le seuil ; monotone (ne recule pas)", async () => {
      assert.equal(await store().getInvalidBefore("u9"), null);
      await store().revokeAllForSubject("u9", 1000);
      assert.equal(await store().getInvalidBefore("u9"), 1000);
      await store().revokeAllForSubject("u9", 500); // recul ignoré
      assert.equal(await store().getInvalidBefore("u9"), 1000);
      await store().revokeAllForSubject("u9", 2000); // avance acceptée
      assert.equal(await store().getInvalidBefore("u9"), 2000);
    });

    it("CONCURRENT : le seuil ne RECULE pas (sinon des jetons révoqués redeviennent valides)", async () => {
      // Le plus grave de la classe. Séquentiel, la monotonie tient ; c'est ICI
      // qu'elle casse. Un findOne + `if (v > existant)` laisse deux logouts
      // simultanés lire le MÊME état puis écrire tous les deux → le DERNIER
      // reste, même porteur d'un seuil plus ANCIEN.
      await harness.warm?.();
      const results = await Promise.allSettled([
        store().revokeAllForSubject("u-race", 9_000),
        store().revokeAllForSubject("u-race", 1_000), // retardataire, plus ancien
      ]);
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(
        await store().getInvalidBefore("u-race"),
        9_000,
        "le seuil le plus RÉCENT survit",
      );
    });

    it("CONCURRENT × 10 en ordre dispersé : le maximum survit", async () => {
      await harness.warm?.();
      const seuils = [
        500, 9_000, 1_200, 4_000, 700, 10_000, 3_300, 200, 6_100, 800,
      ];
      const results = await Promise.allSettled(
        seuils.map((s) => store().revokeAllForSubject("u-race10", s)),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(await store().getInvalidBefore("u-race10"), 10_000);
    });

    it("seuil ÉGAL au courant : idempotent (ni recul, ni erreur)", async () => {
      await store().revokeAllForSubject("u-eq", 5_000);
      await store().revokeAllForSubject("u-eq", 5_000); // rejeu exact
      assert.equal(await store().getInvalidBefore("u-eq"), 5_000);
    });

    it("les seuils sont ISOLÉS par porteur (le logout d'un user n'invalide pas les autres)", async () => {
      await store().revokeAllForSubject("iso-a", 8_000);
      await store().revokeAllForSubject("iso-b", 2_000);
      assert.equal(await store().getInvalidBefore("iso-a"), 8_000);
      assert.equal(await store().getInvalidBefore("iso-b"), 2_000);
      assert.equal(
        await store().getInvalidBefore("iso-c"),
        null,
        "jamais posé → null",
      );
    });

    it("epoch ms RÉALISTE (13 chiffres) : pas de troncature en bigint/integer", async () => {
      // Un seuil est un `Date.now()` réel (~1.7e12) : au-delà de l'`int32`. Les
      // tests à 1000/9000 ne prouvent RIEN sur ce point — une colonne trop
      // étroite se verrait ici, pas avant.
      const reel = 1_775_000_000_123;
      await store().revokeAllForSubject("u-epoch", reel);
      assert.equal(await store().getInvalidBefore("u-epoch"), reel);
    });
  });

  // ── Garbage collector ───────────────────────────────────────────────────────
  describe("gc (purge portable, IS NULL au critère)", () => {
    it.skipIf(!clockExpiry)(
      "purge expirés / denylist expirée / PAT révoqués anciens, garde le reste",
      async () => {
        await purge();
        CLOCK = 100_000_000;
        const nowMs = CLOCK;

        // 1. denylist : une expirée, une vivante.
        await store().denyJti("gc-dead", nowMs - 1);
        await store().denyJti("gc-alive", nowMs + 3_600_000);
        // 2. records : un expiré, un vivant.
        await store().put(makeRecord({ id: "gc-exp", expiresAt: nowMs - 1 }));
        await store().put(
          makeRecord({ id: "gc-live", expiresAt: nowMs + 60_000 }),
        );
        // 3. PAT révoqués SANS expiration : un au-delà de la rétention, un dedans.
        await store().put(
          makeRecord({
            id: "gc-old",
            expiresAt: null,
            revokedAt: nowMs - RETENTION_MS - 1,
            revokedReason: "manual",
          }),
        );
        await store().put(
          makeRecord({
            id: "gc-recent",
            expiresAt: null,
            revokedAt: nowMs - 1000,
            revokedReason: "manual",
          }),
        );
        // Un PAT actif sans expiration NE DOIT JAMAIS être purgé.
        await store().put(makeRecord({ id: "gc-pat", expiresAt: null }));

        letTtlElapse();
        const purged = await store().gc(nowMs);
        assert.equal(
          purged,
          purgedBy(3),
          "denylist expirée + record expiré + PAT trop vieux",
        );
        assert.equal(await store().isJtiDenied("gc-dead"), false);

        assert.equal(await store().isJtiDenied("gc-alive"), true);
        assert.equal(await store().findById("gc-exp"), null);
        assert.ok(await store().findById("gc-live"), "record vivant gardé");
        assert.equal(await store().findById("gc-old"), null);
        assert.ok(await store().findById("gc-recent"), "révoqué récent gardé");
        assert.ok(
          await store().findById("gc-pat"),
          "PAT actif sans exp : JAMAIS purgé",
        );
      },
    );

    it.skipIf(!clockExpiry || nativeTtl)(
      "BORNE exacte : un record qui expire PILE à `now` est purgé ($lte)",
      async () => {
        await purge();
        const nowMs = 200_000_000;
        await store().put(makeRecord({ id: "b-pile", expiresAt: nowMs }));
        await store().put(makeRecord({ id: "b-apres", expiresAt: nowMs + 1 }));
        assert.equal(
          await store().gc(nowMs),
          1,
          "seul celui expiré à l'instant pile",
        );
        assert.equal(await store().findById("b-pile"), null);
        assert.ok(await store().findById("b-apres"), "1 ms plus tard : survit");
      },
    );

    it.skipIf(!clockExpiry)(
      "gc REJOUÉ : idempotent, et ne purge rien de plus (0 au 2ᵉ passage)",
      async () => {
        // Le gc tourne périodiquement sur chaque pod ; deux passages rapprochés ne
        // doivent pas se marcher dessus ni compter deux fois les mêmes lignes.
        await purge();
        const nowMs = 300_000_000;
        CLOCK = nowMs;
        await store().put(makeRecord({ id: "r-exp", expiresAt: nowMs - 1 }));
        await store().denyJti("r-jti", nowMs - 1);
        letTtlElapse();
        assert.equal(await store().gc(nowMs), purgedBy(2));
        assert.equal(await store().gc(nowMs), 0, "rien de neuf à purger");
        assert.equal(await store().findById("r-exp"), null);
      },
    );

    it.skipIf(!clockExpiry)(
      "gc CONCURRENT : deux pods qui purgent en même temps ne lèvent pas",
      async () => {
        // Cas réel du cluster : chaque pod a son timer. Les deux DELETE se
        // recouvrent — le perdant doit simplement compter 0, jamais échouer.
        await harness.warm?.();
        await purge();
        const nowMs = 400_000_000;
        CLOCK = nowMs;
        await store().put(makeRecord({ id: "c-exp", expiresAt: nowMs - 1 }));
        await store().denyJti("c-jti", nowMs - 1);
        letTtlElapse();
        const results = await Promise.allSettled([
          store().gc(nowMs),
          store().gc(nowMs),
          store().gc(nowMs),
        ]);
        assert.deepEqual(rejections(results), [], "aucun gc rejeté");
        const total = results
          .filter((r) => r.status === "fulfilled")
          .reduce((s, r) => s + (r as PromiseFulfilledResult<number>).value, 0);
        assert.equal(
          total,
          purgedBy(2),
          "chaque ligne n'est comptée qu'UNE fois, par un seul pod",
        );
        assert.equal(await store().findById("c-exp"), null);
      },
    );

    it("gc ne touche JAMAIS un jeton vivant, même massivement (garde anti-purge)", async () => {
      // Le pire scénario d'un gc qui déraille : purger des jetons valides =
      // déconnexion de masse. On lui donne 20 vivants et 0 mort.
      await purge();
      const nowMs = 500_000_000;
      CLOCK = nowMs;
      for (let i = 0; i < 20; i++) {
        await store().put(
          makeRecord({ id: `alive-${i}`, expiresAt: nowMs + 3_600_000 }),
        );
      }
      assert.equal(await store().gc(nowMs), 0, "aucun vivant purgé");
      assert.equal((await store().listAll()).length, 20);
    });
  });
}
