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
 * mémoïsée ne compile qu'UNE fois, un repli (`$or`, `$nin`, `$like`, `$in`
 * vide ou long, transaction, cache plein) recompile à chaque exécution. La preuve du
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

  it("SQLite : le LIMIT lié passe par CAST, jamais un `?` nu (recompilé à chaque exécution)", async () => {
    // Un `LIMIT ?` nu fait RECOMPILER la requête par SQLite à chaque exécution
    // (+11 µs mesurés) : findOne le payait sur chaque requête authentifiée.
    // Formes propres à ce test (aucun autre ne les compile avant lui).
    await repo.findOne({ active: true });
    await repo.find({ note: "n3" }, { limit: 2, offset: 1 });
    const selects = prepareCalls.filter((s) =>
      s.includes("prepared_select_probe"),
    );
    assert.ok(selects.length > 0, "des SELECT ont été compilés");
    for (const text of selects) {
      assert.match(text, /limit cast\(\? as integer\)/i, text);
      assert.doesNotMatch(text, /limit \?/i, text);
    }
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

  it("$in court = PRÉPARÉ : sa CARDINALITÉ fait la forme, ses valeurs sont RE-BINDÉES", async () => {
    const in1 = await repo.find({ age: { $in: [25, 30] } });
    const in2 = await repo.find({ age: { $in: [35, 40] } });
    // Débranché (`$in` en repli), chaque find recompile → 2.
    assert.equal(probeSelects(), 1, "même cardinalité = 1 forme");
    assert.deepEqual(in1.map((r) => r.name).sort(), ["alice", "bob", "dan"]);
    assert.deepEqual(in2.map((r) => r.name).sort(), ["chloé", "eve"]);
    await repo.find({ age: { $in: [25] } });
    assert.equal(probeSelects(), 2, "autre cardinalité = autre forme");
    // Chaque valeur est encodée par SA colonne : `false` doit partir en 0.
    const inactive = await repo.find({ active: { $in: [false] } });
    assert.deepEqual(
      inactive.map((r) => r.name),
      ["eve"],
    );
    const direct = await orm.transaction(async (tx) =>
      repo.withTransaction(tx).find({ age: { $in: [25, 30] } }),
    );
    assert.deepEqual(direct, in1, "parité préparé / chemin direct");
  });

  it("$or, $in VIDE et $in LONG = REPLI — recompilent à chaque exécution, résultats justes", async () => {
    const empty1 = await repo.find({ age: { $in: [] } });
    const empty2 = await repo.find({ age: { $in: [] } });
    assert.equal(probeSelects(), 2, "$in vide : 2 exécutions = 2 compilations");
    assert.deepEqual(empty1, []);
    assert.deepEqual(empty2, []);
    prepareCalls = [];
    const many = Array.from({ length: 33 }, (_, k) => k + 10);
    const long1 = await repo.find({ age: { $in: many } });
    await repo.find({ age: { $in: many } });
    assert.equal(probeSelects(), 2, "$in de 33 valeurs : repli");
    assert.deepEqual(long1.map((r) => r.age).sort(), [25, 25, 30, 35, 40]);
    prepareCalls = [];
    const or = await repo.find({
      $or: [{ name: "alice" }, { name: "eve" }],
    });
    await repo.find({ $or: [{ name: "alice" }, { name: "eve" }] });
    assert.equal(probeSelects(), 2, "$or : repli");
    assert.deepEqual(or.map((r) => r.name).sort(), ["alice", "eve"]);
  });

  it("les formes $in ont leur BUDGET : au-delà, repli, sans prendre le cache commun", async () => {
    const twin = orm.getRepository<ProbeRow>("prepared_select_twin");
    const twinSelects = (): number =>
      prepareCalls.filter(
        (s) =>
          s.includes("prepared_select_twin") &&
          s.trimStart().toLowerCase().startsWith("select"),
      ).length;
    // 32 cardinalités = 32 formes `$in` : le budget est plein.
    for (let n = 1; n <= 32; n++) {
      await twin.find({ age: { $in: Array.from({ length: n }, (_, k) => k) } });
    }
    assert.equal(twinSelects(), 32);
    prepareCalls = [];
    await twin.find({ name: { $in: ["alice"] } });
    await twin.find({ name: { $in: ["alice"] } });
    assert.equal(twinSelects(), 2, "budget `$in` épuisé : repli");
    prepareCalls = [];
    await twin.find({ name: "alice" });
    await twin.find({ name: "bob" });
    assert.equal(twinSelects(), 1, "une forme SANS `$in` reste préparée");
  });

  it("comparaisons scalaires préparées : UNE compilation, bornes RE-BINDÉES, parité avec le chemin direct", async () => {
    const window = (lo: number, hi: number) =>
      repo.find({ age: { $gt: lo, $lte: hi } }, { order: [["age", "ASC"]] });
    const a = await window(25, 35);
    const b = await window(30, 40);
    const c = await window(25, 35);
    // Débranché (opérateurs en repli), chaque appel recompile → 3.
    assert.equal(probeSelects(), 1, "même combinaison d'opérateurs = 1 forme");
    assert.deepEqual(
      a.map((r) => r.age),
      [30, 35],
    );
    assert.deepEqual(
      b.map((r) => r.age),
      [35, 40],
      "bornes re-bindées, jamais figées à la 1re exécution",
    );
    assert.deepEqual(c, a);
    const direct = await orm.transaction(async (tx) =>
      repo
        .withTransaction(tx)
        .find({ age: { $gt: 25, $lte: 35 } }, { order: [["age", "ASC"]] }),
    );
    assert.deepEqual(direct, a, "parité préparé / chemin direct");
  });

  it("la COMBINAISON d'opérateurs et la valeur de $null font la forme ; $ne binde par la colonne (bool)", async () => {
    const gt = await repo.find({ age: { $gt: 30 } });
    const gte = await repo.find({ age: { $gte: 30 } });
    const noted = await repo.find({ note: { $null: false } });
    const unnoted = await repo.find({ note: { $null: true } });
    assert.equal(
      probeSelects(),
      4,
      "$gt / $gte / IS NOT NULL / IS NULL = 4 formes",
    );
    assert.deepEqual(gt.map((r) => r.age).sort(), [35, 40]);
    assert.deepEqual(gte.map((r) => r.age).sort(), [30, 35, 40]);
    assert.deepEqual(noted.map((r) => r.name).sort(), ["alice", "chloé"]);
    assert.deepEqual(unnoted.map((r) => r.name).sort(), ["bob", "dan", "eve"]);
    // `false` doit partir en 0 (mapToDriverValue du bool), sinon 0 ligne.
    const inactive = await repo.find({ active: { $ne: true } });
    assert.deepEqual(
      inactive.map((r) => r.name),
      ["eve"],
    );
  });

  it("$in mêlé à une comparaison sur le même champ = UNE forme (la combinaison)", async () => {
    const wide = await repo.find({ age: { $gt: 20, $in: [25, 30] } });
    const narrow = await repo.find({ age: { $gt: 26, $in: [25, 30] } });
    assert.equal(probeSelects(), 1, "même combinaison = 1 forme");
    assert.deepEqual(wide.map((r) => r.name).sort(), ["alice", "bob", "dan"]);
    assert.deepEqual(
      narrow.map((r) => r.name),
      ["alice"],
      "la borne $gt est re-bindée",
    );
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
    });
    const viaFallback = await orm.transaction(async (tx) =>
      repo.withTransaction(tx).find({ tags: ["a", "b"] }),
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
    await repo.updateOne({ id: fred.id }, { age: 26 });
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
