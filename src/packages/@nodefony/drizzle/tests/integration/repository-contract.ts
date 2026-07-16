import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { UnknownCriteriaField } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  createFrameworkTableFactory,
  type FrameworkTableFactory,
} from "../../nodefony/entity/colKit";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * BANC DE PARITÉ DES CONTRATS `IRepository` **et `IOrm`** — LA même suite,
 * exécutée sur les TROIS dialectes (sqlite toujours, postgres/mysql gatés par
 * l'infra).
 *
 * **Pourquoi ce banc existe** : les chemins d'exécution divergent radicalement
 * par dialecte (RETURNING sqlite/pg vs re-SELECT-par-PK mysql, `ON CONFLICT`
 * vs `ON DUPLICATE KEY UPDATE`, `limit(-1)` vs OFFSET seul vs sentinel…) — la
 * seule preuve que le CONTRAT est identique, verbe par verbe, est de faire
 * passer les mêmes assertions aux trois backends. Un développeur d'application
 * qui change `NF_DATABASE_URL` ne doit observer AUCUNE différence de
 * comportement : chaque écart trouvé ici est un bug du framework, pas de
 * l'app.
 *
 * Divergence sémantique ASSUMÉE (non testée, documentée) : la sensibilité à la
 * casse de `$like` suit la collation du backend (sqlite/mysql insensibles par
 * défaut, PG sensible) — le banc n'utilise que des motifs à casse exacte.
 */

/** Table sonde couvrant tous les kinds + defaults JS + index. */
const probeFactory: FrameworkTableFactory = createFrameworkTableFactory({
  name: "repo_contract_probe",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    name: { kind: "text", notNull: true },
    age: { kind: "int", notNull: true },
    score: { kind: "int", notNull: true },
    tags: { kind: "json" },
    active: { kind: "bool", notNull: true, defaultFn: () => true },
    createdAt: { kind: "epochMs", notNull: true, defaultFn: () => Date.now() },
    note: { kind: "text" },
  },
  indexes: [{ name: "repo_contract_probe_age_idx", on: ["age"] }],
});

interface ProbeRow {
  id: string;
  name: string;
  age: number;
  score: number;
  tags: unknown;
  active: boolean;
  createdAt: number;
  note: string | null;
}

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface IContractRunOptions {
  dialect: SqlDialect;
  /** Clé UNIQUE d'ORM (isole l'entité sonde dans le registre process-wide). */
  connector: string;
  /** Options de connexion (filename sqlite / url pg-mysql). */
  connection: { filename?: string; url?: string };
}

/**
 * Déroule la suite de contrat sur un dialecte. À appeler DANS un `describe`
 * (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runRepositoryContract(opts: IContractRunOptions): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let repo: IRepository<ProbeRow>;

  const seed = async (): Promise<void> => {
    await repo.delete({});
    await repo.createMany([
      { name: "alice", age: 30, score: 10, tags: ["a", "b"], note: "n1" },
      { name: "bob", age: 25, score: 20, tags: [], note: null },
      { name: "chloé 👩‍💻", age: 35, score: 30, tags: ["c"], note: "n3" },
      { name: "dan", age: 25, score: 40, tags: null, note: null },
    ]);
  };

  beforeAll(async () => {
    entityRegistry.register({
      connector,
      name: "repo_contract_probe",
      schema: probeFactory(dialect),
    });
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    repo = orm.getRepository<ProbeRow>("repo_contract_probe");
    await repo.delete({}); // table persistante entre les runs (IF NOT EXISTS)
  });

  afterAll(async () => {
    await repo.delete({});
    await orm.disconnect();
    entityRegistry.unregister("repo_contract_probe", connector);
    ormRegistry.unregister(connector);
  });

  it("create : rend LA ligne persistée, defaults JS appliqués (id UUID, active, createdAt)", async () => {
    const row = await repo.create({ name: "eve", age: 40, score: 1 });
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.name, "eve");
    assert.equal(row.active, true, "defaultFn bool");
    assert.equal(typeof row.createdAt, "number", "defaultFn epochMs");
    assert.equal(row.note, null, "colonne omise nullable → null");
    const reread = await repo.findOne({ id: row.id });
    assert.deepEqual(reread, row, "la ligne rendue EST la ligne stockée");
  });

  it("createMany : N lignes rendues, ORDRE d'insertion préservé", async () => {
    await repo.delete({});
    const rows = await repo.createMany([
      { name: "m1", age: 1, score: 1 },
      { name: "m2", age: 2, score: 2 },
      { name: "m3", age: 3, score: 3 },
    ]);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["m1", "m2", "m3"],
    );
    assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  });

  it("round-trip types : json (array/objet), bool, epochMs, unicode/emoji", async () => {
    const at = 1_700_000_000_123;
    const created = await repo.create({
      name: "Ünïcode 👩‍💻 テスト",
      age: 99,
      score: 0,
      tags: { deep: { list: [1, "two", false], n: null } },
      active: false,
      createdAt: at,
    });
    const row = await repo.findOne({ id: created.id });
    assert.ok(row);
    assert.equal(row.name, "Ünïcode 👩‍💻 テスト");
    assert.deepEqual(row.tags, { deep: { list: [1, "two", false], n: null } });
    assert.equal(row.active, false);
    assert.equal(row.createdAt, at, "epoch ms exact (64-bit)");
  });

  it("find : criteria eq + opérateurs riches ($gt/$in/$like/$ne/$nin)", async () => {
    await seed();
    assert.equal((await repo.find({ age: 25 })).length, 2);
    assert.equal((await repo.find({ age: { $gt: 25 } })).length, 2);
    assert.equal((await repo.find({ age: { $gte: 25 } })).length, 4);
    assert.equal((await repo.find({ age: { $in: [25, 35] } })).length, 3);
    assert.equal((await repo.find({ age: { $nin: [25] } })).length, 2);
    assert.equal((await repo.find({ name: { $ne: "alice" } })).length, 3);
    const like = await repo.find({ name: { $like: "ali%" } });
    assert.deepEqual(
      like.map((r) => r.name),
      ["alice"],
    );
  });

  it("find : order / limit / offset — et OFFSET-SANS-LIMIT (hack routé par dialecte)", async () => {
    await seed();
    const desc = await repo.find(undefined, { order: [["score", "DESC"]] });
    assert.deepEqual(
      desc.map((r) => r.score),
      [40, 30, 20, 10],
    );
    const page = await repo.find(undefined, {
      order: [["score", "ASC"]],
      limit: 2,
      offset: 1,
    });
    assert.deepEqual(
      page.map((r) => r.score),
      [20, 30],
    );
    // OFFSET sans LIMIT : sqlite exige limit(-1), PG l'interdit, MySQL exige
    // un sentinel — trois émissions, UN comportement.
    const tail = await repo.find(undefined, {
      order: [["score", "ASC"]],
      offset: 2,
    });
    assert.deepEqual(
      tail.map((r) => r.score),
      [30, 40],
    );
  });

  it("findOne : première du critère, null si absent", async () => {
    await seed();
    const one = await repo.findOne({ name: "bob" });
    assert.equal(one?.age, 25);
    assert.equal(await repo.findOne({ name: "nobody" }), null);
  });

  it("updateOne : rend la ligne persistée MÊME si le critère porte sur le champ modifié (B1)", async () => {
    await seed();
    const row = await repo.updateOne({ name: "alice" }, { age: 31 });
    assert.equal(row?.age, 31);
    const moved = await repo.updateOne({ age: 31 }, { age: 32 });
    assert.equal(
      moved?.age,
      32,
      "critère sur le champ modifié — pas de null à tort",
    );
    assert.equal(await repo.updateOne({ name: "nobody" }, { age: 1 }), null);
  });

  it("updateOne : borné à AU PLUS UNE ligne quand plusieurs matchent", async () => {
    await seed();
    const row = await repo.updateOne({ age: 25 }, { score: 777 });
    assert.equal(row?.score, 777);
    assert.equal(
      (await repo.find({ score: 777 })).length,
      1,
      "une seule des deux lignes age=25 modifiée",
    );
  });

  it("updateMany : compteur EXACT de lignes affectées", async () => {
    await seed();
    assert.equal(await repo.updateMany({ age: 25 }, { score: 5 }), 2);
    assert.equal(await repo.updateMany({ age: 999 }, { score: 5 }), 0);
  });

  it("increment : delta côté SQL, ligne rendue, null si introuvable", async () => {
    await seed();
    const row = await repo.increment({ name: "alice" }, { score: 7 });
    assert.equal(row?.score, 17);
    const again = await repo.increment({ name: "alice" }, { score: -2 });
    assert.equal(again?.score, 15);
    assert.equal(await repo.increment({ name: "nobody" }, { score: 1 }), null);
  });

  it("upsert : chemin INSERT (insertOnly posé) puis chemin UPDATE (insertOnly PRÉSERVÉ)", async () => {
    await repo.delete({});
    const inserted = await repo.upsert(
      { id: "up-1" },
      { score: 1, name: "vera", age: 50 },
      { note: "created-once", tags: ["seed"] },
    );
    assert.equal(inserted.note, "created-once");
    assert.equal(inserted.score, 1);
    const updated = await repo.upsert(
      { id: "up-1" },
      { score: 2, name: "vera", age: 50 },
      { note: "MUST-NOT-OVERWRITE", tags: ["other"] },
    );
    assert.equal(updated.score, 2, "update appliqué au conflit");
    assert.equal(
      updated.note,
      "created-once",
      "champ insert-only jamais écrasé au conflit",
    );
    assert.equal(await repo.count({ id: "up-1" }), 1, "toujours UNE ligne");
  });

  it("delete : compteur ; deleteOne : AU PLUS UNE ; findOneAndDelete : rend la ligne", async () => {
    await seed();
    assert.equal(await repo.delete({ age: 999 }), 0);
    assert.equal(await repo.deleteOne({ age: 25 }), true);
    assert.equal(
      (await repo.find({ age: 25 })).length,
      1,
      "une seule des deux lignes age=25 supprimée",
    );
    const gone = await repo.findOneAndDelete({ name: "alice" });
    assert.equal(gone?.name, "alice");
    assert.equal(await repo.findOne({ name: "alice" }), null);
    assert.equal(await repo.findOneAndDelete({ name: "alice" }), null);
    assert.equal(await repo.delete({}), 2, "purge finale comptée");
  });

  it("count / exists", async () => {
    await seed();
    assert.equal(await repo.count(), 4);
    assert.equal(await repo.count({ age: 25 }), 2);
    assert.equal(await repo.exists({ name: "bob" }), true);
    assert.equal(await repo.exists({ name: "nobody" }), false);
  });

  it("criteria strict : champ inconnu → UnknownCriteriaField (jamais un skip silencieux)", async () => {
    await assert.rejects(
      repo.find({ ghost: 1 } as never),
      UnknownCriteriaField,
    );
  });

  // ── Transactions ────────────────────────────────────────────────────────────
  // Le contrat le plus cher à casser : une transaction qui ne tient pas rend une
  // écriture partielle DURABLE. Ces cas manquaient au banc — d'où un
  // `transaction()` resté sqlite-only, invisible tant que seuls les tests
  // `:memory:` l'appelaient.
  //
  // Le rollback est aussi ce qui prouve l'ATOMICITÉ sur un pool : si `BEGIN` et
  // les écritures partaient sur des connexions différentes (pg/mysql), l'INSERT
  // serait auto-committé et survivrait au rollback.
  //
  // Divergence sémantique ASSUMÉE (non testée ici, comme la casse de `$like`) :
  // la visibilité AVANT commit depuis un repository NON lié. En sqlite la
  // connexion est unique — la transaction encadre le db du connecteur, donc tout
  // repository lit/écrit dedans ; en postgres/mysql la transaction tient une
  // connexion dédiée du pool, invisible du reste. Seule règle portable, donc
  // seule testée : `withTransaction(tx)` est le SEUL moyen d'entrer dans la
  // transaction, et après commit la ligne est visible de partout.

  it("transaction : commit — les écritures liées par withTransaction sont durables", async () => {
    await repo.delete({});
    const out = await orm.transaction(async (tx) => {
      const txRepo = repo.withTransaction(tx);
      await txRepo.create({ name: "tx-commit-1", age: 1, score: 1 });
      await txRepo.create({ name: "tx-commit-2", age: 2, score: 2 });
      return "done";
    });
    assert.equal(out, "done");
    assert.equal(await repo.count({}), 2);
  });

  it("transaction : rollback — la closure qui rejette n'a RIEN persisté, l'erreur remonte", async () => {
    await repo.delete({});
    await assert.rejects(
      orm.transaction(async (tx) => {
        const txRepo = repo.withTransaction(tx);
        await txRepo.create({ name: "tx-rollback", age: 1, score: 1 });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await repo.count({}), 0);
  });

  it("transaction : savepoint / rollbackTo — annulation PARTIELLE, la transaction continue", async () => {
    await repo.delete({});
    await orm.transaction(async (tx) => {
      const txRepo = repo.withTransaction(tx);
      await txRepo.create({ name: "kept", age: 1, score: 1 });
      await tx.savepoint("sp1");
      await txRepo.create({ name: "dropped", age: 2, score: 2 });
      await tx.rollbackTo("sp1");
      await txRepo.create({ name: "kept-after", age: 3, score: 3 });
    });
    // Ordre sur `age` (entier), jamais sur `name` : la PK est un UUID aléatoire
    // (donc l'ordre physique l'est aussi) et le tri d'un texte suivrait la
    // collation du backend — deux raisons d'échouer pour rien.
    const names = (await repo.find({}, { order: [["age", "ASC"]] })).map(
      (r) => r.name,
    );
    assert.deepEqual(names, ["kept", "kept-after"]);
  });

  it("transaction : la connexion est RENDUE au pool — N transactions d'affilée sans épuisement", async () => {
    await repo.delete({});
    // Un pool par défaut plafonne à 10 connexions (pg comme mysql2) : sans
    // `release()`, ce test se fige à la 11ᵉ au lieu d'échouer — d'où le compte
    // volontairement au-dessus du plafond, commits ET rollbacks mélangés.
    for (let i = 0; i < 15; i++) {
      await orm.transaction(async (tx) => {
        await repo
          .withTransaction(tx)
          .create({ name: `loop-${i}`, age: i, score: i });
      });
      await assert.rejects(
        orm.transaction(async (tx) => {
          await repo
            .withTransaction(tx)
            .create({ name: `undone-${i}`, age: i, score: i });
          throw new Error("rollback");
        }),
        /rollback/,
      );
    }
    assert.equal(await repo.count({}), 15);
  });

  it("transaction : CONCURRENTES — 15 simultanées passent toutes (pool de 10 / connexion unique)", async () => {
    await repo.delete({});
    // Le cas réel : N requêtes HTTP simultanées font chacune une transaction.
    // Séquentiel, tout marche ; c'est ICI que ça casse. Le nombre dépasse le
    // pool par défaut (10) exprès → prouve que l'attente d'une connexion est une
    // FILE, pas un échec. En sqlite (connexion unique = pool de 1), la file est
    // portée par l'adapter, sinon le 2ᵉ `BEGIN` échoue (« cannot start a
    // transaction within a transaction »).
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) =>
        orm.transaction(async (tx) => {
          const txRepo = repo.withTransaction(tx);
          await txRepo.create({ name: `conc-${i}`, age: i, score: i });
          // Tenir la transaction ouverte : sans ça, elles se sérialisent d'elles-
          // mêmes et le chevauchement — donc le bug — ne se produit jamais.
          await new Promise((resolve) => setTimeout(resolve, 20));
        }),
      ),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    assert.deepEqual(
      rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
      [],
      "aucune transaction concurrente ne doit être rejetée",
    );
    assert.equal(await repo.count({}), 15, "les 15 écritures sont durables");
  });

  it("transaction : concurrentes ISOLÉES — un rollback n'emporte pas les voisines", async () => {
    await repo.delete({});
    // Corollaire du cas précédent : sérialiser ne doit pas mélanger. Chaque
    // transaction garde son sort propre (sqlite : la file ne doit pas laisser
    // deux travaux tomber dans le même BEGIN).
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        orm.transaction(async (tx) => {
          await repo
            .withTransaction(tx)
            .create({ name: `mix-${i}`, age: i, score: i });
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (i % 2 === 1) {
            throw new Error(`rollback-${i}`);
          }
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "rejected").length, 3);
    const names = (await repo.find({}, { order: [["age", "ASC"]] })).map(
      (r) => r.name,
    );
    assert.deepEqual(names, ["mix-0", "mix-2", "mix-4"], "seuls les pairs");
  });

  it("transaction : hors connexion → `not connected` (jamais un silence)", async () => {
    const offline = new DrizzleOrm(`${connector}_offline`, {
      dialect,
      ...opts.connection,
    });
    try {
      await assert.rejects(
        offline.transaction(async () => undefined),
        /not connected/,
      );
      assert.equal(offline.isConnected(), false);
    } finally {
      ormRegistry.unregister(`${connector}_offline`);
    }
  });

  // ── Contrat IOrm (introspection / santé) ────────────────────────────────────
  // Même angle mort que `transaction()` : ces méthodes n'étaient exercées QUE
  // sur sqlite. Or elles alimentent le data plane admin (panneau Studio ORM) —
  // un adapter qui ne répond qu'en dev laisse la prod muette, en silence.

  it("isConnected / getNativeConnection : vrais sur un connecteur connecté", async () => {
    assert.equal(orm.isConnected(), true);
    assert.ok(
      orm.getNativeConnection(),
      "trappe SQL brut (ADR-0003 risque #1)",
    );
  });

  it("ping : round-trip RÉEL vers la base, sans erreur", async () => {
    await orm.ping();
  });

  it("describeConnection : driver = dialecte, cible renseignée, ZÉRO credential", async () => {
    const info = orm.describeConnection();
    assert.equal(info.driver, dialect);
    assert.ok(info.target, "cible affichée dans Studio");
    assert.ok(info.ormVersion, "version de l'ORM");
    // Le data plane expose cette cible : un mot de passe d'`url` qui fuiterait
    // ici partirait dans Studio (et dans ses logs).
    const dump = JSON.stringify(info);
    assert.ok(
      !/nodefony-dev|password|:\/\/[^/]*:[^@]*@/.test(dump),
      `credential fuité dans describeConnection(): ${dump}`,
    );
  });

  it("describeEntity : colonnes normalisées (alimente l'ERD / l'IA du data plane)", async () => {
    const cols = orm.describeEntity("repo_contract_probe");
    const byName = new Map(cols.map((c) => [c.name, c]));
    assert.ok(cols.length >= 8, "toutes les colonnes de la sonde");
    assert.equal(byName.get("id")?.primaryKey, true);
    assert.equal(byName.get("name")?.nullable, false, "notNull → non nullable");
    assert.equal(byName.get("note")?.nullable, true);
    assert.ok(byName.get("age")?.type, "type SQL du dialecte");
    assert.deepEqual(orm.describeEntity("ghost"), [], "entité inconnue → []");
  });

  it("probe : JAMAIS muette sur un connecteur connecté (storage sqlite / pool serveur)", async () => {
    const p = await orm.probe();
    assert.ok(
      Object.keys(p).length > 0,
      "sonde vide = panneau Studio ORM muet en production",
    );
    if (dialect === "sqlite") {
      // Mono-connexion : la sonde utile est le stockage (PRAGMA).
      assert.equal(typeof p.storage?.sizeBytes, "number");
    } else {
      // Base serveur : le pool EST la métrique qui compte (saturation à
      // `pool.max` = la falaise de RPS mesurée au banc de charge).
      assert.equal(typeof p.pool?.size, "number", "taille max du pool");
      assert.equal(typeof p.pool?.available, "number", "connexions idle");
      assert.equal(typeof p.pool?.borrowed, "number", "connexions en usage");
      assert.ok((p.pool?.size ?? 0) > 0, "un plafond de 0 ne veut rien dire");
      // La sonde doit REFLÉTER l'état, pas seulement avoir la bonne forme : une
      // transaction tient une connexion dédiée, donc elle est EMPRUNTÉE. Sans
      // cette assertion, des compteurs figés à 0 passeraient le test.
      await orm.transaction(async () => {
        const during = await orm.probe();
        assert.ok(
          (during.pool?.borrowed ?? 0) >= 1,
          `transaction en cours → ≥1 connexion empruntée, sonde: ${JSON.stringify(during.pool)}`,
        );
      });
    }
  });
}
