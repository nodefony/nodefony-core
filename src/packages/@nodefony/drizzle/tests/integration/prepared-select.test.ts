/// <reference types="node" />
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { createFrameworkTableFactory } from "../../nodefony/entity/colKit";

/**
 * SELECT préparés mémoïsés par FORME (`DrizzleRepository.#preparedSelect`) —
 * le remède au goulot du cycle ORM (build+prepare drizzle refaits à chaque
 * requête HTTP, ~48 % du CPU du chemin read).
 *
 * La preuve du MÉCANISME passe par un compteur de compilations NATIVES :
 * `Database.prototype.prepare` (better-sqlite3) est espionné — une forme
 * mémoïsée ne compile qu'UNE fois, un repli (opérateurs riches, `$or`,
 * transaction, cache plein) recompile à chaque exécution. La preuve du
 * CONTRAT (les résultats ne changent pas d'un chemin à l'autre) s'appuie sur
 * `withTransaction`, qui garde le chemin non préparé par construction — le
 * banc de parité 3 dialectes (`repository-contract-*`) reste le filet global.
 */

const probeFactory = createFrameworkTableFactory({
  name: "prepared_select_probe",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    name: { kind: "text", notNull: true },
    age: { kind: "int", notNull: true },
    active: { kind: "bool", notNull: true, defaultFn: () => true },
    tags: { kind: "json" },
    note: { kind: "text" },
  },
});

/** Jumelle de la sonde (mêmes colonnes) — prouve l'isolation des caches par entité. */
const twinFactory = createFrameworkTableFactory({
  name: "prepared_select_twin",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    name: { kind: "text", notNull: true },
    age: { kind: "int", notNull: true },
    active: { kind: "bool", notNull: true, defaultFn: () => true },
    tags: { kind: "json" },
    note: { kind: "text" },
  },
});

interface ProbeRow {
  id: string;
  name: string;
  age: number;
  active: boolean;
  tags: unknown;
  note: string | null;
}

const CONNECTOR = "prepared_select_probe_orm";

type PrepareFn = typeof Database.prototype.prepare;

describe("DrizzleRepository — SELECT préparés mémoïsés (sqlite)", () => {
  let orm: DrizzleOrm;
  let repo: IRepository<ProbeRow>;
  let prepareCalls: string[] = [];
  const originalPrepare: PrepareFn = Database.prototype.prepare;

  /** Compilations natives de SELECT sur LA table sonde depuis le dernier reset. */
  const probeSelects = (): number =>
    prepareCalls.filter(
      (s) =>
        s.includes("prepared_select_probe") &&
        s.trimStart().toLowerCase().startsWith("select"),
    ).length;

  beforeAll(async () => {
    Database.prototype.prepare = function (
      this: InstanceType<typeof Database>,
      source: string,
    ) {
      prepareCalls.push(source);
      return originalPrepare.call(this, source);
    } as PrepareFn;
    entityRegistry.register({
      connector: CONNECTOR,
      name: "prepared_select_probe",
      schema: probeFactory("sqlite"),
    });
    entityRegistry.register({
      connector: CONNECTOR,
      name: "prepared_select_twin",
      schema: twinFactory("sqlite"),
    });
    orm = new DrizzleOrm(CONNECTOR, {
      dialect: "sqlite",
      filename: ":memory:",
    });
    await orm.connect();
    repo = orm.getRepository<ProbeRow>("prepared_select_probe");
    await repo.createMany([
      { name: "alice", age: 30, tags: ["a", "b"], note: "n1" },
      { name: "bob", age: 25, tags: [], note: null },
      { name: "chloé", age: 35, tags: ["c"], note: "n3" },
      { name: "dan", age: 25, tags: null, note: null },
      { name: "eve", age: 40, active: false, tags: null, note: null },
    ]);
  });

  afterAll(async () => {
    Database.prototype.prepare = originalPrepare;
    await orm.disconnect();
    entityRegistry.unregister("prepared_select_probe", CONNECTOR);
    entityRegistry.unregister("prepared_select_twin", CONNECTOR);
    ormRegistry.unregister(CONNECTOR);
  });

  beforeEach(() => {
    prepareCalls = [];
  });

  it("même forme exécutée N fois → UNE seule compilation native, valeurs RE-BINDÉES", async () => {
    const r1 = await repo.find({ age: 30 }, { limit: 20 });
    const r2 = await repo.find({ age: 25 }, { limit: 20 });
    const r3 = await repo.find({ age: 30 }, { limit: 20 });
    // Débranché (repli forcé), chaque find recompile → 3 : le test tombe ROUGE.
    assert.equal(probeSelects(), 1, "1 forme = 1 compilation native");
    // Les valeurs discriminent : un placeholder figé rendrait 3 fois la même page.
    assert.deepEqual(
      r1.map((r) => r.name),
      ["alice"],
    );
    assert.deepEqual(r2.map((r) => r.name).sort(), ["bob", "dan"]);
    assert.deepEqual(r3, r1, "re-exécution stable de la même forme");
  });

  it("findOne réutilise la forme (limit = placeholder) et re-binde", async () => {
    const a = await repo.findOne({ name: "alice" });
    const c = await repo.findOne({ name: "chloé" });
    assert.equal(probeSelects(), 1, "findOne = find(limit 1), même forme");
    assert.equal(a?.age, 30);
    assert.equal(c?.age, 35);
  });

  it("null en critère = IS NULL = forme DISTINCTE de l'égalité (non paramétrable)", async () => {
    const anonymous = await repo.find({ note: null });
    const named = await repo.find({ note: "n1" });
    assert.equal(probeSelects(), 2, "2 formes (IS NULL vs = ?)");
    assert.deepEqual(anonymous.map((r) => r.name).sort(), [
      "bob",
      "dan",
      "eve",
    ]);
    assert.deepEqual(
      named.map((r) => r.name),
      ["alice"],
    );
  });

  it("limit ET offset sont des placeholders : leurs valeurs varient sans recompiler", async () => {
    const order: [string, "ASC" | "DESC"][] = [["age", "ASC"]];
    const two = await repo.find({}, { order, limit: 2 });
    const three = await repo.find({}, { order, limit: 3 });
    const skipped = await repo.find({}, { order, limit: 3, offset: 1 });
    assert.equal(probeSelects(), 2, "limit seul / limit+offset = 2 formes");
    assert.equal(two.length, 2);
    assert.equal(three.length, 3);
    assert.deepEqual(
      skipped.map((r) => r.age),
      [25, 30, 35],
      "offset bindé : saute LA première ligne du tri",
    );
  });

  it("le tri fait partie de la FORME : ASC et DESC rendent deux ordres justes", async () => {
    const asc = await repo.find({}, { order: [["age", "ASC"]] });
    const desc = await repo.find({}, { order: [["age", "DESC"]] });
    assert.equal(probeSelects(), 2, "ASC / DESC = 2 formes");
    assert.deepEqual(
      asc.map((r) => r.age),
      [25, 25, 30, 35, 40],
    );
    assert.deepEqual(
      desc.map((r) => r.age),
      [40, 35, 30, 25, 25],
    );
  });

  it("opérateurs riches et $or = REPLI (le SQL varie avec la cardinalité) — recompile à chaque exécution", async () => {
    const in1 = await repo.find({ age: { $in: [25, 30] } });
    const in2 = await repo.find({ age: { $in: [25, 30] } });
    assert.equal(probeSelects(), 2, "repli : 2 exécutions = 2 compilations");
    assert.deepEqual(in1.map((r) => r.name).sort(), ["alice", "bob", "dan"]);
    assert.deepEqual(in2, in1);
    const or = await repo.find({
      $or: [{ name: "alice" }, { name: "eve" }],
    } as Partial<ProbeRow>);
    assert.deepEqual(or.map((r) => r.name).sort(), ["alice", "eve"]);
  });

  it("transaction = REPLI (handle éphémère) — et rend EXACTEMENT ce que rend le chemin préparé", async () => {
    const viaPrepared = await repo.find({ age: 25 }, { limit: 20 });
    prepareCalls = [];
    const viaTx = await orm.transaction(async (tx) =>
      repo.withTransaction(tx).find({ age: 25 }, { limit: 20 }),
    );
    const viaTx2 = await orm.transaction(async (tx) =>
      repo.withTransaction(tx).find({ age: 25 }, { limit: 20 }),
    );
    assert.equal(probeSelects(), 2, "en tx, chaque exécution recompile");
    assert.deepEqual(viaTx, viaPrepared, "parité préparé / non préparé");
    assert.deepEqual(viaTx2, viaPrepared);
  });

  it("critère sur colonne JSON et bool : le mapToDriverValue s'applique AU BIND (parité avec le chemin non préparé)", async () => {
    const viaPrepared = await repo.find({
      tags: ["a", "b"],
    } as Partial<ProbeRow>);
    const viaFallback = await orm.transaction(async (tx) =>
      repo.withTransaction(tx).find({ tags: ["a", "b"] } as Partial<ProbeRow>),
    );
    assert.deepEqual(viaPrepared, viaFallback, "parité json");
    assert.equal(viaPrepared.length, 1, "le critère MORD (pas toute la table)");
    assert.equal(viaPrepared[0]?.name, "alice");
    const inactive = await repo.find({ active: false });
    assert.deepEqual(
      inactive.map((r) => r.name),
      ["eve"],
      "bool → integer au bind",
    );
  });

  it("🔴 ANTI-STALENESS : une forme mémoïsée rend TOUJOURS l'état COURANT de la base (cache de FORME, jamais de DONNÉES)", async () => {
    // Amorce la forme (la met au cache), puis fait muter la table par les
    // TROIS verbes d'écriture : chaque relecture de la MÊME forme préparée
    // doit voir la mutation — sans jamais recompiler.
    const shape = () => repo.find({ age: 25 }, { limit: 20 });
    const before = await shape();
    const baseline = before.map((r) => r.name).sort();
    assert.deepEqual(baseline, ["bob", "dan"], "état initial");
    prepareCalls = [];
    const fred = await repo.create({
      name: "fred",
      age: 25,
      tags: null,
      note: null,
    });
    const afterInsert = await shape();
    assert.deepEqual(
      afterInsert.map((r) => r.name).sort(),
      ["bob", "dan", "fred"],
      "l'INSERT est visible à la relecture immédiate",
    );
    await repo.updateOne({ id: fred.id }, { age: 26 } as Partial<ProbeRow>);
    const afterUpdate = await shape();
    assert.deepEqual(
      afterUpdate.map((r) => r.name).sort(),
      ["bob", "dan"],
      "l'UPDATE sort la ligne du critère bindé",
    );
    await repo.deleteOne({ id: fred.id });
    const afterDelete = await shape();
    assert.deepEqual(
      afterDelete.map((r) => r.name).sort(),
      baseline,
      "le DELETE ramène l'état initial",
    );
    assert.equal(
      probeSelects(),
      0,
      "trois relectures fraîches, ZÉRO recompilation : la forme est cachée, pas les données",
    );
  });

  it("les caches de formes sont PAR entité : même forme de critère, chaque repository rend SES lignes", async () => {
    const twin = orm.getRepository<ProbeRow>("prepared_select_twin");
    await twin.delete({});
    await twin.createMany([
      { name: "zoé", age: 25, tags: null, note: null },
      { name: "yann", age: 30, tags: null, note: null },
    ]);
    // MÊME forme (mêmes champs, même limit) sur les deux entités.
    const fromProbe = await repo.find({ age: 25 }, { limit: 20 });
    const fromTwin = await twin.find({ age: 25 }, { limit: 20 });
    assert.deepEqual(fromProbe.map((r) => r.name).sort(), ["bob", "dan"]);
    assert.deepEqual(fromTwin.map((r) => r.name).sort(), ["zoé"]);
  });

  it("cache PLEIN (128 formes) : les formes excédentaires passent en repli, les mémoïsées restent servies", async () => {
    // Sature le cache avec des formes de tri distinctes (le tri fait partie
    // de la forme). La table a 6 colonnes triables → 6×5×4 permutations de
    // 3 colonnes × 2 sens, largement > 128.
    const cols = ["id", "name", "age", "active", "tags", "note"];
    const orders: [string, "ASC" | "DESC"][][] = [];
    for (const a of cols) {
      for (const b of cols) {
        for (const c of cols) {
          if (a !== b && b !== c && a !== c) {
            orders.push([
              [a, "ASC"],
              [b, "ASC"],
              [c, "ASC"],
            ]);
            orders.push([
              [a, "DESC"],
              [b, "ASC"],
              [c, "ASC"],
            ]);
          }
        }
      }
    }
    for (const order of orders.slice(0, 140)) {
      const rows = await repo.find({ age: 25 }, { order, limit: 1 });
      assert.equal(rows.length, 1, "chaque forme rend une ligne juste");
    }
    // Une forme déjà mémoïsée AVANT saturation reste servie sans recompiler.
    prepareCalls = [];
    const hit = await repo.find({ age: 30 }, { limit: 20 });
    assert.equal(
      probeSelects(),
      0,
      "forme mémoïsée avant saturation : 0 compilation",
    );
    assert.deepEqual(
      hit.map((r) => r.name),
      ["alice"],
    );
    // Une forme NEUVE au-delà du cap recompile à CHAQUE exécution (repli borné).
    const overflow: [string, "ASC" | "DESC"][] = [
      ["note", "DESC"],
      ["tags", "DESC"],
      ["id", "DESC"],
    ];
    prepareCalls = [];
    await repo.find({ age: 25 }, { order: overflow, limit: 1 });
    await repo.find({ age: 25 }, { order: overflow, limit: 1 });
    assert.equal(probeSelects(), 2, "au-delà du cap : repli, 2 compilations");
  });
});
