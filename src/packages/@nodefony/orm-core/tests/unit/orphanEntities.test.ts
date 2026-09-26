import assert from "node:assert/strict";
import {
  describeOrphanEntities,
  findOrphanEntities,
  reportOrphanEntities,
} from "../../nodefony/src/orphanEntities";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";
import type { IEntity } from "../../nodefony/interfaces/index";

// Vécu : sur une infra MongoDB, le `User` de l'application restait une table SQL
// inscrite sur `default`, que Drizzle n'ouvre pas sur cette infra — et le boot
// n'en disait rien. Ces cas gardent la règle qui le DIT.
const entity = (name: string, connector: string, module = "app"): IEntity => ({
  name,
  connector,
  module,
  schema: {},
});

describe("entités orphelines — inscrites sur un connecteur qu'aucun ORM n'ouvre", () => {
  it("trouve celles dont le connecteur n'est pas ouvert, et elles seules", () => {
    const orphans = findOrphanEntities(
      [
        entity("User", "default"),
        entity("session", "nodefony", "http"),
        entity("Visit", "analytics", "stats"),
      ],
      ["nodefony", "analytics"],
    );
    assert.deepEqual(
      orphans.map((e) => `${e.name}@${e.connector}`),
      ["User@default"],
    );
  });

  it("aucun orphelin : aucun message", () => {
    assert.equal(
      describeOrphanEntities(
        findOrphanEntities([entity("User", "nodefony")], ["nodefony"]),
        ["nodefony"],
      ),
      null,
    );
  });

  it("le message NOMME l'entité, son connecteur, les connecteurs ouverts et le remède", () => {
    const message = describeOrphanEntities(
      [entity("User", "default")],
      ["nodefony"],
    );
    assert.ok(message);
    assert.match(message, /User@app → « default »/u);
    assert.match(message, /Connecteurs ouverts : nodefony/u);
    assert.match(message, /NF_DATABASE_URL/u);
    assert.match(message, /nodefony inspect entities/u);
  });
  it("un connecteur DÉCLARÉ mais jamais ouvert : la cause est l'échec d'avant, pas l'entité", () => {
    // `connectAll` s'arrête au premier connecteur en échec : les suivants ne
    // sont jamais construits. Accuser leurs entités enverrait chercher ailleurs.
    const message = describeOrphanEntities(
      [entity("Visit", "analytics", "stats"), entity("Ghost", "typo")],
      ["default"],
      ["default", "analytics"],
    );
    assert.ok(message);
    assert.match(
      message,
      /DÉCLARÉ mais jamais ouvert : Visit@stats → « analytics »/u,
    );
    assert.match(message, /erreur de connexion plus haut/u);
    // …et l'inconnu reste accusé, lui — sans l'entité déclarée.
    const accusation = message.split("DÉCLARÉ")[0] ?? "";
    assert.match(accusation, /Ghost@app → « typo »/u);
    assert.doesNotMatch(accusation, /Visit/u);
  });
});

// Le rapport lui-même — ce qui rougit si l'appel ou sa garde disparaît.
describe("reportOrphanEntities — le démarrage le DIT, une fois par Kernel", () => {
  const orphan = entity("Ghost", "never-opened-connector", "orphans");

  it("NOMME l'orpheline au journal, en WARNING", () => {
    entityRegistry.register(orphan);
    try {
      const lines: string[] = [];
      const message = reportOrphanEntities(
        (m, severity) => lines.push(`${severity} ${m}`),
        {},
      );
      assert.ok(message);
      assert.equal(lines.length, 1);
      assert.match(
        lines[0],
        /^WARNING .*Ghost@orphans → « never-opened-connector »/u,
      );
    } finally {
      entityRegistry.unregister("Ghost", "never-opened-connector");
    }
  });

  it("un second ORM du même démarrage se tait ; un AUTRE démarrage parle", () => {
    entityRegistry.register(orphan);
    try {
      const kernel = {};
      const lines: string[] = [];
      const log = (m: string) => lines.push(m);
      reportOrphanEntities(log, kernel);
      assert.equal(reportOrphanEntities(log, kernel), null);
      assert.equal(lines.length, 1);
      reportOrphanEntities(log, {});
      assert.equal(lines.length, 2);
    } finally {
      entityRegistry.unregister("Ghost", "never-opened-connector");
    }
  });
});
