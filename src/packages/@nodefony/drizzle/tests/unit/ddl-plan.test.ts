import assert from "node:assert/strict";
import {
  planTableCreation,
  explainOmittedForeignKeys,
} from "../../nodefony/src/orm-core/ddlPlan";

/**
 * L'ordre de création des tables, éprouvé sans base.
 *
 * Deux raisons de le tester ici plutôt que sur un serveur : un cycle entre
 * entités ne se provoque pas à la demande sur une base réelle, et SQLite — le
 * moteur du développement — ne peut PAS servir de juge : il résout ses clés
 * étrangères tardivement et accepte une table qui en désigne une inexistante.
 * PostgreSQL et MySQL refusent. L'algorithme doit donc être juste avant que le
 * serveur ne le dise.
 */
describe("plan de création — l'ordre suit les dépendances", () => {
  it("une cible naît avant qui la désigne", () => {
    const plan = planTableCreation([
      { name: "post", references: ["author"] },
      { name: "author", references: [] },
    ]);
    assert.deepEqual([...plan.order], ["author", "post"]);
    assert.deepEqual([...plan.omitted], []);
  });

  it("une chaîne de trois est ordonnée de bout en bout", () => {
    const plan = planTableCreation([
      { name: "comment", references: ["post"] },
      { name: "post", references: ["author"] },
      { name: "author", references: [] },
    ]);
    assert.deepEqual([...plan.order], ["author", "post", "comment"]);
  });

  // Une table qui se désigne elle-même ne dépend de rien : les trois moteurs
  // acceptent la contrainte dans son propre `CREATE TABLE`.
  it("l'auto-référence ne crée aucune dépendance", () => {
    const plan = planTableCreation([
      { name: "category", references: ["category"] },
    ]);
    assert.deepEqual([...plan.order], ["category"]);
    assert.deepEqual([...plan.omitted], []);
  });

  // Le cas qu'aucun ordre ne résout. Il ne doit pas empêcher de démarrer, et il
  // ne doit pas non plus disparaître en silence.
  it("un cycle : les tables sont posées, la contrainte en arrière est OMISE", () => {
    const plan = planTableCreation([
      { name: "a", references: ["b"] },
      { name: "b", references: ["a"] },
    ]);
    assert.deepEqual([...plan.order].sort(), ["a", "b"]);
    assert.equal(plan.omitted.length, 1);
    assert.equal(plan.omitted[0]?.reason, "cycle");
    // Celle qui est abandonnée est celle qui regarde en arrière : la seconde
    // table créée garde la sienne, puisque sa cible existe déjà.
    assert.equal(plan.omitted[0]?.table, plan.order[0]);
    assert.equal(plan.omitted[0]?.target, plan.order[1]);
  });

  it("un cycle n'emporte pas les tables saines", () => {
    const plan = planTableCreation([
      { name: "a", references: ["b"] },
      { name: "b", references: ["a"] },
      { name: "post", references: ["author"] },
      { name: "author", references: [] },
    ]);
    // Les tables sans cycle passent d'abord, dans leur ordre de dépendance.
    assert.ok(
      plan.order.indexOf("author") < plan.order.indexOf("post"),
      `ordre inattendu : ${plan.order.join(", ")}`,
    );
    assert.equal(
      plan.omitted.filter((entry) => entry.table === "post").length,
      0,
    );
  });

  // Une entité déclarée sur un AUTRE connecteur vit dans une autre base :
  // l'intégrité référentielle ne traverse pas deux bases.
  it("une cible absente de ce connecteur est nommée, pas ignorée", () => {
    const plan = planTableCreation([
      { name: "post", references: ["ailleurs"] },
    ]);
    assert.deepEqual([...plan.order], ["post"]);
    assert.equal(plan.omitted.length, 1);
    assert.equal(plan.omitted[0]?.reason, "absent");
    assert.equal(plan.omitted[0]?.target, "ailleurs");
  });

  // Deux démarrages de la même application doivent produire le même DDL, sinon
  // un journal n'est pas comparable d'un jour à l'autre.
  it("l'ordre ne dépend pas de l'ordre d'arrivée", () => {
    const premier = planTableCreation([
      { name: "b", references: [] },
      { name: "a", references: [] },
      { name: "c", references: [] },
    ]);
    const second = planTableCreation([
      { name: "c", references: [] },
      { name: "b", references: [] },
      { name: "a", references: [] },
    ]);
    assert.deepEqual([...premier.order], [...second.order]);
  });

  it("deux colonnes vers la même cible ne comptent qu'une dépendance", () => {
    const plan = planTableCreation([
      { name: "message", references: ["user", "user"] },
      { name: "user", references: [] },
    ]);
    assert.deepEqual([...plan.order], ["user", "message"]);
    assert.deepEqual([...plan.omitted], []);
  });
});

describe("plan de création — ce qui est abandonné se DIT", () => {
  it("rien à signaler ne produit aucun message", () => {
    assert.equal(explainOmittedForeignKeys([]), null);
  });

  // Un avertissement qui ne nomme ni la cause ni le geste se relit deux fois
  // puis s'ignore.
  it("le message nomme les tables, la cause et le geste", () => {
    const message = explainOmittedForeignKeys([
      { table: "a", target: "b", reason: "cycle" },
    ]);
    assert.equal(typeof message, "string");
    for (const attendu of ["a → b", "cycle", "orm:generate"]) {
      assert.ok(
        (message as string).includes(attendu),
        `« ${attendu} » absent de : ${message}`,
      );
    }
  });

  it("une cible hors base est distinguée d'un cycle", () => {
    const message = explainOmittedForeignKeys([
      { table: "post", target: "ailleurs", reason: "absent" },
    ]);
    assert.ok(
      (message as string).includes("autre connecteur"),
      `la cause n'est pas nommée : ${message}`,
    );
  });
});
